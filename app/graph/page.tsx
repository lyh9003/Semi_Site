"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Node {
  id: number;
  name: string;
  type: string;
  mentionCount?: number;
  isHot?: boolean;
  x?: number;
  y?: number;
}
interface Edge {
  from_entity_id: number;
  to_entity_id: number;
  weight: number;
  relation_type?: string;
  relation_desc?: string;
}
interface RenderLink {
  source: Node;
  target: Node;
  weight: number;
  relation_type?: string;
  relation_desc?: string;
}
interface EntityDoc {
  news: {id:number;title:string;company:string;date:string;summary:string;link:string}[];
  reports: {id:number;title:string;securities_firm:string;date:string;summary:string;link:string}[];
  telegrams: {id:number;channel:string;summary:string;date_utc:string;sentiment:string}[];
  total: number;
}

// ─── 색상 ─────────────────────────────────────────────────────────────────────
const TYPE_COLOR: Record<string, string> = {
  company: "#3b82f6",
  product: "#10b981",
  metric:  "#f59e0b",
  event:   "#ef4444",
  sector:  "#8b5cf6",
};
const TYPE_LABEL: Record<string, string> = {
  company: "기업",
  product: "제품/기술",
  metric:  "지표",
  event:   "이벤트",
  sector:  "섹터",
};
const RELATION_COLOR: Record<string, string> = {
  수혜:     "#10b981",  // emerald
  공급망:   "#3b82f6",  // blue
  경쟁:     "#ef4444",  // red
  수요연동: "#f59e0b",  // amber
  리스크:   "#dc2626",  // dark red
  양방향:   "#8b5cf6",  // purple
  포함관계: "#94a3b8",  // slate
  무관계:   "#e2e8f0",  // light gray
};
const RELATION_TYPES_ALL = Object.keys(RELATION_COLOR);
const ENTITY_TYPES = ["", "company", "product", "metric", "event", "sector"];

// ─── DAG 컬럼 정의 (왼→오 인과 흐름) ──────────────────────────────────────────
const DAG_COLS = [
  { type: "event",   label: "매크로/이벤트" },
  { type: "sector",  label: "섹터" },
  { type: "product", label: "제품/기술" },
  { type: "company", label: "기업" },
  { type: "metric",  label: "지표" },
] as const;
const COL_SPACING = 210;
const NODE_ROW_H  = 44;
const HEADER_H    = 56;
const PAD_X       = 90;
const PAD_Y       = 24;

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function GraphPage() {
  const svgRef        = useRef<SVGSVGElement>(null);
  const tooltipRef    = useRef<HTMLDivElement>(null);
  const [nodes, setNodes]             = useState<Node[]>([]);
  const [edges, setEdges]             = useState<Edge[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [entityDocs, setEntityDocs]   = useState<EntityDoc | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [summary, setSummary]         = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [narrative, setNarrative]     = useState("");
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [filterType, setFilterType]   = useState("");
  const [minWeight, setMinWeight]     = useState(3);
  const [search, setSearch]           = useState("");
  const [showHotOnly, setShowHotOnly] = useState(true);
  const [activeTab, setActiveTab]     = useState<"docs"|"narrative">("narrative");

  const loadGraph = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: "200",
      minWeight: String(minWeight),
      ...(filterType ? { type: filterType } : {}),
    });
    const res = await fetch(`/api/graph?${params}`);
    const data = await res.json();
    setNodes(data.nodes ?? []);
    setEdges(data.edges ?? []);
    setLoading(false);
    setSelectedNode(null);
    setEntityDocs(null);
  }, [filterType, minWeight]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  const handleNodeClick = useCallback(async (node: Node) => {
    setSelectedNode(node);
    setDocsLoading(true);
    setEntityDocs(null);
    setSummary("");
    setSummaryLoading(true);
    setNarrative("");
    setNarrativeLoading(true);
    setActiveTab("narrative");

    const [docsRes, sumRes] = await Promise.all([
      fetch(`/api/graph/entity?id=${node.id}`),
      fetch("/api/graph/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId: node.id, entityName: node.name, entityType: node.type }),
      }),
    ]);

    const data = await docsRes.json();
    setEntityDocs(data);
    setDocsLoading(false);

    if (sumRes.ok && sumRes.body) {
      const reader = sumRes.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setSummary(prev => prev + decoder.decode(value, { stream: true }));
      }
    }
    setSummaryLoading(false);
  }, []);

  // 내러티브: 선택 노드의 이웃 관계를 edges에서 뽑아 API 호출
  const loadNarrative = useCallback(async (node: Node, allEdges: Edge[]) => {
    setNarrative("");
    setNarrativeLoading(true);

    const nodeMap = new Map<number, Node>();
    nodes.forEach(n => nodeMap.set(n.id, n));

    const relations = allEdges
      .filter(e => e.from_entity_id === node.id || e.to_entity_id === node.id)
      .map(e => {
        const isOut = e.from_entity_id === node.id;
        const neighbor = nodeMap.get(isOut ? e.to_entity_id : e.from_entity_id);
        if (!neighbor) return null;
        return {
          neighborName: neighbor.name,
          neighborType: neighbor.type,
          direction: isOut ? "outgoing" : "incoming",
          relation_type: e.relation_type,
          relation_desc: e.relation_desc,
          weight: e.weight,
        };
      })
      .filter(Boolean);

    const res = await fetch("/api/graph/narrative", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityName: node.name, entityType: node.type, relations }),
    });

    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setNarrative(prev => prev + decoder.decode(value, { stream: true }));
      }
    }
    setNarrativeLoading(false);
  }, [nodes]);

  useEffect(() => {
    if (selectedNode && edges.length > 0) {
      loadNarrative(selectedNode, edges);
    }
  }, [selectedNode, edges, loadNarrative]);

  // D3 렌더링 — 계층형 DAG 고정 레이아웃
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const svgW = svgRef.current.clientWidth  || 1100;
    const svgH = svgRef.current.clientHeight || 700;

    const g = svg.append("g");
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.15, 3])
        .on("zoom", event => g.attr("transform", event.transform))
    );

    // 화살표 마커 (순방향 + 역방향)
    const defs = svg.append("defs");
    [...RELATION_TYPES_ALL, "default"].forEach(rtype => {
      const color = RELATION_COLOR[rtype] ?? "#cbd5e1";
      ["", "back-"].forEach(prefix => {
        defs.append("marker")
          .attr("id", `arrow-${prefix}${rtype.replace(/\s/g, "")}`)
          .attr("viewBox", "0 -4 8 8")
          .attr("refX", 22).attr("refY", 0)
          .attr("markerWidth", 5).attr("markerHeight", 5)
          .attr("orient", "auto")
          .append("path").attr("d", "M0,-4L8,0L0,4")
          .attr("fill", color)
          .attr("opacity", prefix ? 0.35 : 0.85);
      });
    });

    // ── 노드 컬럼 배치 ──────────────────────────────────────────────────────
    const hotIds = new Set(nodes.filter(n => n.isHot).map(n => n.id));
    const metricsLinkedToHot = new Set(
      edges.flatMap(e => {
        const fromIsHot = hotIds.has(e.from_entity_id);
        const toIsHot   = hotIds.has(e.to_entity_id);
        const fromNode  = nodes.find(n => n.id === e.from_entity_id);
        const toNode    = nodes.find(n => n.id === e.to_entity_id);
        const out: number[] = [];
        if (fromIsHot && toNode?.type === "metric")   out.push(e.to_entity_id);
        if (toIsHot   && fromNode?.type === "metric") out.push(e.from_entity_id);
        return out;
      })
    );
    const topMetrics = new Set(
      [...metricsLinkedToHot]
        .map(id => nodes.find(n => n.id === id)!)
        .filter(Boolean)
        .sort((a, b) => (b.mentionCount ?? 0) - (a.mentionCount ?? 0))
        .slice(0, 8)
        .map(n => n.id)
    );
    const filteredNodes = showHotOnly
      ? nodes.filter(n => n.isHot || topMetrics.has(n.id))
      : nodes;
    const filteredNodeIds = new Set(filteredNodes.map(n => n.id));

    const colTypeIndex = new Map<string, number>(DAG_COLS.map((c, i) => [c.type, i]));
    const colBuckets = new Map<string, Node[]>();
    DAG_COLS.forEach(c => colBuckets.set(c.type, []));
    filteredNodes.forEach(n => {
      colBuckets.get(n.type)?.push(n);
    });
    colBuckets.forEach(bucket =>
      bucket.sort((a, b) => (b.mentionCount ?? 0) - (a.mentionCount ?? 0))
    );

    const maxRows = Math.max(...[...colBuckets.values()].map(b => b.length), 1);
    const dagH    = Math.max(svgH, HEADER_H + PAD_Y + maxRows * NODE_ROW_H + PAD_Y);

    DAG_COLS.forEach((col, ci) => {
      const x = PAD_X + ci * COL_SPACING;
      const bucket = colBuckets.get(col.type) ?? [];
      const totalH = bucket.length * NODE_ROW_H;
      const startY = HEADER_H + PAD_Y + (dagH - HEADER_H - PAD_Y * 2 - totalH) / 2;
      bucket.forEach((node, ri) => {
        node.x = x;
        node.y = startY + ri * NODE_ROW_H;
      });
    });

    // ── 컬럼 헤더 ──────────────────────────────────────────────────────────
    const headerG = g.append("g");
    DAG_COLS.forEach((col, ci) => {
      const x = PAD_X + ci * COL_SPACING;
      const count = colBuckets.get(col.type)?.length ?? 0;

      // 세로 가이드 라인
      headerG.append("line")
        .attr("x1", x).attr("y1", HEADER_H)
        .attr("x2", x).attr("y2", dagH - PAD_Y)
        .attr("stroke", TYPE_COLOR[col.type]).attr("stroke-opacity", 0.1)
        .attr("stroke-width", 1).attr("stroke-dasharray", "4 4");

      // 헤더 배경
      headerG.append("rect")
        .attr("x", x - 58).attr("y", 8)
        .attr("width", 116).attr("height", 34)
        .attr("rx", 8)
        .attr("fill", TYPE_COLOR[col.type]).attr("opacity", 0.12);

      // 컬럼명
      headerG.append("text")
        .attr("x", x).attr("y", 22)
        .attr("text-anchor", "middle")
        .attr("font-size", "11px").attr("font-weight", "700")
        .attr("fill", TYPE_COLOR[col.type])
        .text(col.label);

      // 노드 수
      headerG.append("text")
        .attr("x", x).attr("y", 36)
        .attr("text-anchor", "middle")
        .attr("font-size", "9px").attr("fill", TYPE_COLOR[col.type]).attr("opacity", 0.7)
        .text(`${count}개`);

      // 컬럼 간 화살표
      if (ci < DAG_COLS.length - 1) {
        const nx = PAD_X + (ci + 1) * COL_SPACING;
        headerG.append("line")
          .attr("x1", x + 62).attr("y1", 25)
          .attr("x2", nx - 62).attr("y2", 25)
          .attr("stroke", "#cbd5e1").attr("stroke-width", 1.5)
          .attr("marker-end", "url(#arrow-default)");
      }
    });

    // ── 엣지 (베지어 곡선) ─────────────────────────────────────────────────
    const renderLinks: RenderLink[] = edges
      .filter(e =>
        filteredNodeIds.has(e.from_entity_id) &&
        filteredNodeIds.has(e.to_entity_id) &&
        e.relation_type && e.relation_type !== "무관계"
      )
      .map(e => ({
        source: filteredNodes.find(n => n.id === e.from_entity_id)!,
        target: filteredNodes.find(n => n.id === e.to_entity_id)!,
        weight: e.weight,
        relation_type: e.relation_type,
        relation_desc: e.relation_desc,
      }))
      .filter(l => l.source?.x !== undefined && l.target?.x !== undefined);

    const linkG = g.append("g");
    renderLinks
      .sort((a, b) => a.weight - b.weight)
      .forEach(d => {
        const sx = d.source.x!, sy = d.source.y!;
        const tx = d.target.x!, ty = d.target.y!;
        const si = colTypeIndex.get(d.source.type) ?? 0;
        const ti = colTypeIndex.get(d.target.type) ?? 0;
        const color = RELATION_COLOR[d.relation_type ?? ""] ?? "#cbd5e1";
        const mkey  = (d.relation_type ?? "default").replace(/\s/g, "");

        let pathD: string;
        const isBackward = si > ti;
        const isIntra    = si === ti;

        if (isIntra) {
          const offset = 50 + Math.abs(sy - ty) * 0.3;
          pathD = `M${sx},${sy} C${sx + offset},${sy} ${tx + offset},${ty} ${tx},${ty}`;
        } else {
          const mx = (sx + tx) / 2;
          pathD = `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
        }

        linkG.append("path")
          .attr("d", pathD)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", Math.min(d.weight * 0.25, 2.5))
          .attr("stroke-opacity", isBackward ? 0.18 : 0.55)
          .attr("stroke-dasharray", isBackward ? "5,4" : (isIntra ? "3,2" : "none"))
          .attr("marker-end", `url(#arrow-${isBackward ? "back-" : ""}${mkey})`)
          .style("cursor", d.relation_desc ? "pointer" : "default")
          .on("mousemove", (event) => {
            if (!tooltipRef.current || !d.relation_desc) return;
            const tip = tooltipRef.current;
            tip.style.display = "block";
            tip.style.left = `${event.pageX + 12}px`;
            tip.style.top  = `${event.pageY - 28}px`;
            tip.innerHTML =
              `<span style="color:${color};font-weight:700">${d.relation_type ?? ""}</span><br/>${d.relation_desc}`;
          })
          .on("mouseleave", () => {
            if (tooltipRef.current) tooltipRef.current.style.display = "none";
          });
      });

    // ── 노드 ───────────────────────────────────────────────────────────────
    const nodeG = g.append("g")
      .selectAll<SVGGElement, Node>("g")
      .data(filteredNodes.filter(n => n.x !== undefined))
      .join("g")
      .attr("transform", d => `translate(${d.x},${d.y})`)
      .style("cursor", "pointer")
      .on("mousemove", (event, d) => {
        if (!tooltipRef.current) return;
        const tip = tooltipRef.current;
        tip.style.display = "block";
        tip.style.left = `${event.pageX + 14}px`;
        tip.style.top  = `${event.pageY - 32}px`;
        const connCount = edges.filter(
          e => e.from_entity_id === d.id || e.to_entity_id === d.id
        ).filter(e => e.relation_type && e.relation_type !== "무관계").length;
        tip.innerHTML =
          `<span style="color:${TYPE_COLOR[d.type]};font-weight:700">${TYPE_LABEL[d.type] ?? d.type}</span>` +
          `<br/><strong>${d.name}</strong>` +
          `<br/><span style="opacity:0.7">언급 ${d.mentionCount ?? 0}회 · 관계 ${connCount}건</span>` +
          (d.isHot ? `<br/><span style="color:#fb923c">🔥 최근 급등</span>` : "");
      })
      .on("mouseleave", () => {
        if (tooltipRef.current) tooltipRef.current.style.display = "none";
      })
      .on("click", (_, d) => handleNodeClick(d));

    const nodeR = (d: Node) => Math.max(6, Math.min(18, 5 + Math.sqrt(d.mentionCount ?? 1)));

    // 핫 링
    nodeG.filter(d => !!d.isHot)
      .append("circle")
      .attr("r", d => nodeR(d) + 6)
      .attr("fill", "none")
      .attr("stroke", "#fb923c")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4 2")
      .attr("opacity", 0.8);

    // 본체
    nodeG.append("circle")
      .attr("r", nodeR)
      .attr("fill", d => TYPE_COLOR[d.type] ?? "#94a3b8")
      .attr("stroke", d => d.isHot ? "#fb923c" : "#fff")
      .attr("stroke-width", d => d.isHot ? 2.5 : 1.5)
      .attr("opacity", 0.92);

    // 검색 하이라이트
    if (search) {
      const q = search.toLowerCase();
      nodeG.filter(d => d.name.toLowerCase().includes(q))
        .append("circle")
        .attr("r", d => nodeR(d) + 5)
        .attr("fill", "none")
        .attr("stroke", "#1d4ed8")
        .attr("stroke-width", 2.5);
    }

    // 레이블 (오른쪽)
    nodeG.append("text")
      .text(d => d.name)
      .attr("x", d => nodeR(d) + 5)
      .attr("y", 4)
      .attr("font-size", "10px")
      .attr("fill", d => d.isHot ? "#ea580c" : "#475569")
      .attr("font-weight", d => d.isHot ? "600" : "normal")
      .attr("pointer-events", "none");

  }, [nodes, edges, search, handleNodeClick, showHotOnly]);

  const hotCount = nodes.filter(n => n.isHot).length;

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">

      {/* ── 왼쪽 컨트롤 패널 ── */}
      <div className="w-64 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
        <div className="p-4 border-b border-slate-100">
          <h1 className="text-base font-bold text-slate-800">🕸️ 지식 그래프</h1>
          <p className="text-xs text-slate-400 mt-0.5">엔티티 간 시황 관계 탐색</p>
        </div>

        <div className="p-3 space-y-3">
          {/* 검색 */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">검색</label>
            <input
              type="text"
              placeholder="엔티티명..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="mt-1 w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50 outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {/* 핫 노드 토글 */}
          <div>
            <button
              onClick={() => setShowHotOnly(v => !v)}
              className={`w-full text-xs px-3 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
                showHotOnly
                  ? "bg-orange-500 text-white"
                  : "bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100"
              }`}
            >
              🔥 최근 14일 급등 엔티티
              {hotCount > 0 && (
                <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${showHotOnly ? "bg-orange-400 text-white" : "bg-orange-100 text-orange-600"}`}>
                  {hotCount}
                </span>
              )}
            </button>
          </div>

          {/* 타입 필터 */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">엔티티 타입</label>
            <div className="mt-1 flex flex-col gap-1">
              {ENTITY_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`text-left text-xs px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${
                    filterType === t ? "bg-slate-800 text-white" : "hover:bg-slate-100 text-slate-600"
                  }`}
                >
                  {t ? (
                    <>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TYPE_COLOR[t] }} />
                      {TYPE_LABEL[t]}
                    </>
                  ) : "전체"}
                </button>
              ))}
            </div>
          </div>

          {/* 최소 관계 강도 */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              최소 관계 강도: {minWeight}
            </label>
            <input
              type="range" min={2} max={20} value={minWeight}
              onChange={e => setMinWeight(Number(e.target.value))}
              className="w-full mt-1"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>촘촘</span><span>희소</span>
            </div>
          </div>
        </div>

        {/* 관계 유형 범례 */}
        <div className="p-3 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">관계 유형</p>
          {Object.entries(RELATION_COLOR).filter(([k]) => k !== "무관계").map(([rtype, color]) => (
            <div key={rtype} className="flex items-center gap-2 mb-1">
              <span className="w-5 h-0.5 flex-shrink-0 rounded" style={{ background: color }} />
              <span className="text-xs text-slate-600">{rtype}</span>
            </div>
          ))}
        </div>

        {/* 노드 타입 범례 */}
        <div className="p-3 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">노드 타입</p>
          {Object.entries(TYPE_LABEL).map(([t, label]) => (
            <div key={t} className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: TYPE_COLOR[t] }} />
              <span className="text-xs text-slate-600">{label}</span>
            </div>
          ))}
          <div className="mt-2 text-[10px] text-slate-400">
            노드 {nodes.length}개 · 관계 {edges.length}개
          </div>
        </div>
      </div>

      {/* ── 중앙: 그래프 ── */}
      <div className="flex-1 relative bg-slate-50">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-slate-400">
              <div className="text-4xl mb-3 animate-spin inline-block">⚙️</div>
              <p className="text-sm">그래프 로딩 중...</p>
            </div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
            조건에 맞는 데이터가 없습니다
          </div>
        ) : (
          <svg ref={svgRef} className="w-full h-full" />
        )}
        <div className="absolute bottom-3 right-3 text-[10px] text-slate-400 bg-white/80 px-2 py-1 rounded">
          스크롤: 줌 · 드래그: 패닝 · 호버: 상세 · 클릭: 분석
        </div>
        {/* 엣지 툴팁 */}
        <div
          ref={tooltipRef}
          className="fixed z-50 hidden max-w-xs text-xs bg-slate-800 text-white px-3 py-2 rounded-lg shadow-xl pointer-events-none leading-relaxed"
          style={{ display: "none" }}
        />
      </div>

      {/* ── 오른쪽: 선택 엔티티 패널 ── */}
      {selectedNode && (
        <div className="w-96 flex-shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
          {/* 헤더 */}
          <div className="p-4 border-b border-slate-100 flex-shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded text-white"
                style={{ background: TYPE_COLOR[selectedNode.type] ?? "#94a3b8" }}
              >
                {TYPE_LABEL[selectedNode.type] ?? selectedNode.type}
              </span>
              {selectedNode.isHot && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-orange-100 text-orange-600">
                  🔥 최근 급등
                </span>
              )}
              <button onClick={() => setSelectedNode(null)} className="ml-auto text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
            </div>
            <h2 className="text-base font-bold text-slate-800">{selectedNode.name}</h2>
            {entityDocs && (
              <p className="text-xs text-slate-400 mt-0.5">총 {entityDocs.total}건 문서에서 언급</p>
            )}
          </div>

          {/* 탭 */}
          <div className="flex border-b border-slate-100 flex-shrink-0">
            {(["narrative", "docs"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 text-xs py-2.5 font-semibold transition-colors ${
                  activeTab === tab
                    ? "text-blue-600 border-b-2 border-blue-600"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                {tab === "narrative" ? "🔗 시황 흐름 분석" : "📄 관련 문서"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* 시황 흐름 탭 */}
            {activeTab === "narrative" && (
              <div className="p-4 space-y-4">
                {/* 관계 기반 내러티브 */}
                <div className="bg-blue-50 rounded-xl p-3">
                  <p className="text-xs font-semibold text-blue-700 mb-2">📡 관계 기반 시황 흐름</p>
                  {narrativeLoading && !narrative && (
                    <p className="text-xs text-slate-400 flex items-center gap-1">
                      <span className="animate-spin inline-block">⚙️</span> 관계 분석 중...
                    </p>
                  )}
                  {(narrative || narrativeLoading) && (
                    <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                      {narrative}
                      {narrativeLoading && <span className="animate-pulse">▌</span>}
                    </p>
                  )}
                </div>

                {/* 연결된 관계 목록 */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">연결 관계</p>
                  {edges
                    .filter(e => e.from_entity_id === selectedNode.id || e.to_entity_id === selectedNode.id)
                    .filter(e => e.relation_type && e.relation_type !== "무관계")
                    .sort((a, b) => b.weight - a.weight)
                    .slice(0, 12)
                    .map((e, i) => {
                      const isOut = e.from_entity_id === selectedNode.id;
                      const neighborId = isOut ? e.to_entity_id : e.from_entity_id;
                      const neighbor = nodes.find(n => n.id === neighborId);
                      const color = RELATION_COLOR[e.relation_type ?? ""] ?? "#94a3b8";
                      return (
                        <div key={i} className="flex items-start gap-2 py-1.5 border-b border-slate-50 last:border-0">
                          <span className="text-[10px] mt-0.5 flex-shrink-0 text-slate-400">
                            {isOut ? "→" : "←"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-medium text-slate-700">{neighbor?.name ?? "?"}</span>
                              <span
                                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{ background: `${color}20`, color }}
                              >
                                {e.relation_type}
                              </span>
                            </div>
                            {e.relation_desc && (
                              <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{e.relation_desc}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>

                {/* 문서 기반 AI 요약 */}
                {(summary || summaryLoading) && (
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-xs font-semibold text-slate-500 mb-2">📰 문서 기반 AI 요약</p>
                    {summaryLoading && !summary && (
                      <p className="text-xs text-slate-400 flex items-center gap-1">
                        <span className="animate-spin inline-block">⚙️</span> 요약 생성 중...
                      </p>
                    )}
                    <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                      {summary}
                      {summaryLoading && <span className="animate-pulse">▌</span>}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* 문서 탭 */}
            {activeTab === "docs" && (
              <>
                {docsLoading && (
                  <div className="p-6 text-center text-slate-400 text-sm">
                    <div className="text-2xl mb-2 animate-spin inline-block">⚙️</div>
                    <p>문서 조회 중...</p>
                  </div>
                )}
                {entityDocs && !docsLoading && (
                  <>
                    {entityDocs.news.length > 0 && (
                      <DocSection title="뉴스" color="blue" docs={entityDocs.news.map(n => ({
                        id: n.id, title: n.title, sub: n.company, date: n.date?.slice(0,10), body: n.summary, link: n.link
                      }))} />
                    )}
                    {entityDocs.reports.length > 0 && (
                      <DocSection title="증권리포트" color="purple" docs={entityDocs.reports.map(r => ({
                        id: r.id, title: r.title, sub: r.securities_firm, date: r.date?.slice(0,10), body: r.summary, link: r.link
                      }))} />
                    )}
                    {entityDocs.telegrams.length > 0 && (
                      <DocSection title="텔레그램" color="teal" docs={entityDocs.telegrams.map(t => ({
                        id: t.id, title: t.summary || "(메시지)", sub: t.channel, date: t.date_utc?.slice(0,10), body: "", link: undefined
                      }))} />
                    )}
                    {entityDocs.news.length + entityDocs.reports.length + entityDocs.telegrams.length === 0 && (
                      <p className="p-6 text-center text-slate-400 text-sm">표시할 문서가 없습니다</p>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 문서 섹션 ────────────────────────────────────────────────────────────────
function DocSection({ title, color, docs }: {
  title: string;
  color: string;
  docs: { id: number; title: string; sub?: string; date?: string; body?: string; link?: string }[];
}) {
  const headerCls: Record<string, string> = {
    blue:   "bg-blue-50 text-blue-700 border-blue-100",
    purple: "bg-purple-50 text-purple-700 border-purple-100",
    teal:   "bg-teal-50 text-teal-700 border-teal-100",
  };
  return (
    <div className="border-b border-slate-100">
      <div className={`px-4 py-2 text-xs font-semibold border-b ${headerCls[color]}`}>
        {title} {docs.length}건
      </div>
      {docs.map(doc => (
        <div key={doc.id} className="px-4 py-3 border-b border-slate-50 last:border-0">
          {doc.link ? (
            <a href={doc.link} target="_blank" rel="noopener noreferrer"
              className="text-xs font-medium text-blue-700 hover:underline line-clamp-2 block mb-1 leading-relaxed">
              {doc.title}
            </a>
          ) : (
            <p className="text-xs font-medium text-slate-700 line-clamp-2 mb-1 leading-relaxed">{doc.title}</p>
          )}
          <div className="flex gap-2 text-[10px] text-slate-400">
            {doc.sub && <span>{doc.sub}</span>}
            {doc.date && <span>· {doc.date}</span>}
          </div>
          {doc.body && (
            <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">{doc.body}</p>
          )}
        </div>
      ))}
    </div>
  );
}
