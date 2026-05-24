"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Node extends d3.SimulationNodeDatum {
  id: number;
  name: string;
  type: string;
  mentionCount?: number;
}
interface Edge {
  from_entity_id: number;
  to_entity_id: number;
  weight: number;
}
interface SimLink extends d3.SimulationLinkDatum<Node> {
  weight: number;
}
interface EntityDoc {
  news: {id:number;title:string;company:string;date:string;summary:string;link:string}[];
  reports: {id:number;title:string;securities_firm:string;date:string;one_line_summary:string;link:string}[];
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

const ENTITY_TYPES = ["", "company", "product", "metric", "event", "sector"];

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function GraphPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [entityDocs, setEntityDocs] = useState<EntityDoc | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [filterType, setFilterType] = useState("");
  const [minWeight, setMinWeight] = useState(3);
  const [search, setSearch] = useState("");
  const simulationRef = useRef<d3.Simulation<Node, SimLink> | null>(null);

  // 데이터 로드
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

  // 노드 클릭 → 문서 조회
  const handleNodeClick = useCallback(async (node: Node) => {
    setSelectedNode(node);
    setDocsLoading(true);
    setEntityDocs(null);
    const res = await fetch(`/api/graph/entity?id=${node.id}`);
    const data = await res.json();
    setEntityDocs(data);
    setDocsLoading(false);
  }, []);

  // D3 그래프 렌더링
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    // 줌
    const g = svg.append("g");
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => g.attr("transform", event.transform))
    );

    // 링크 데이터
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const simLinks: SimLink[] = edges
      .filter(e => nodeById.has(e.from_entity_id) && nodeById.has(e.to_entity_id))
      .map(e => ({
        source: nodeById.get(e.from_entity_id)!,
        target: nodeById.get(e.to_entity_id)!,
        weight: e.weight,
      }));

    // 시뮬레이션
    const simulation = d3.forceSimulation<Node>(nodes)
      .force("link", d3.forceLink<Node, SimLink>(simLinks)
        .id(d => d.id)
        .distance(d => Math.max(60, 120 - d.weight * 3)))
      .force("charge", d3.forceManyBody().strength(-120))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<Node>(d => Math.max(5, Math.min(18, 5 + Math.sqrt(d.mentionCount ?? 1))) + 4));

    simulationRef.current = simulation;

    // 엣지 그리기
    const link = g.append("g")
      .selectAll("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", "#e2e8f0")
      .attr("stroke-width", d => Math.min(d.weight * 0.4, 4))
      .attr("stroke-opacity", 0.6);

    // 노드 그리기
    const node = g.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")
      .call(
        d3.drag<SVGGElement, Node>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null; d.fy = null;
          })
      )
      .on("click", (_, d) => handleNodeClick(d));

    node.append("circle")
      .attr("r", d => Math.max(5, Math.min(18, 5 + Math.sqrt(d.mentionCount ?? 1))))
      .attr("fill", d => TYPE_COLOR[d.type] ?? "#94a3b8")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .attr("opacity", 0.9);

    node.append("text")
      .text(d => d.name)
      .attr("x", 10)
      .attr("y", 4)
      .attr("font-size", "10px")
      .attr("fill", "#475569")
      .attr("pointer-events", "none");

    // 검색 하이라이트
    if (search) {
      const q = search.toLowerCase();
      node.select("circle")
        .attr("r", d => {
          const base = Math.max(5, Math.min(18, 5 + Math.sqrt(d.mentionCount ?? 1)));
          return d.name.toLowerCase().includes(q) ? base + 6 : base;
        })
        .attr("stroke", d => d.name.toLowerCase().includes(q) ? "#1d4ed8" : "#fff")
        .attr("stroke-width", d => d.name.toLowerCase().includes(q) ? 3 : 1.5);
    }

    simulation.on("tick", () => {
      link
        .attr("x1", d => (d.source as Node).x!)
        .attr("y1", d => (d.source as Node).y!)
        .attr("x2", d => (d.target as Node).x!)
        .attr("y2", d => (d.target as Node).y!);
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    return () => { simulation.stop(); };
  }, [nodes, edges, search, handleNodeClick]);

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">

      {/* ── 왼쪽 컨트롤 패널 ── */}
      <div className="w-64 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
        <div className="p-4 border-b border-slate-100">
          <h1 className="text-base font-bold text-slate-800">🕸️ 지식 그래프</h1>
          <p className="text-xs text-slate-400 mt-0.5">엔티티 간 공동출현 관계</p>
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

        {/* 범례 */}
        <div className="p-3 mt-auto border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">범례</p>
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
          스크롤: 줌 · 드래그: 이동 · 노드 클릭: 문서 보기
        </div>
      </div>

      {/* ── 오른쪽: 선택 엔티티 문서 패널 ── */}
      {selectedNode && (
        <div className="w-80 flex-shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex-shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded text-white"
                style={{ background: TYPE_COLOR[selectedNode.type] ?? "#94a3b8" }}
              >
                {TYPE_LABEL[selectedNode.type] ?? selectedNode.type}
              </span>
              <button onClick={() => setSelectedNode(null)} className="ml-auto text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
            </div>
            <h2 className="text-base font-bold text-slate-800">{selectedNode.name}</h2>
            {entityDocs && (
              <p className="text-xs text-slate-400 mt-0.5">총 {entityDocs.total}건 문서에서 언급</p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
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
                    id: r.id, title: r.title, sub: r.securities_firm, date: r.date?.slice(0,10), body: r.one_line_summary, link: r.link
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
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 문서 섹션 컴포넌트 ───────────────────────────────────────────────────────
function DocSection({ title, color, docs }: {
  title: string;
  color: string;
  docs: { id: number; title: string; sub?: string; date?: string; body?: string; link?: string }[];
}) {
  const headerCls: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    purple: "bg-purple-50 text-purple-700 border-purple-100",
    teal: "bg-teal-50 text-teal-700 border-teal-100",
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
