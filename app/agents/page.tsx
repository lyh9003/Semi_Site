"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface AgentMsg {
  type: "message" | "history";
  id: string;
  name: string;
  emoji: string;
  color: string;
  message: string;
  timestamp: string;
}

const AGENT_INFO: Record<string, { desc: string }> = {
  bull:     { desc: "강세론자" },
  bear:     { desc: "약세론자" },
  risk:     { desc: "리스크 관리" },
  analyst:  { desc: "리포트 분석" },
  macro:    { desc: "거시경제" },
  system:   { desc: "시스템" },
};

const WS_URL = "ws://localhost:8765/ws";

export default function AgentsPage() {
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "history") {
          setMessages(data.messages ?? []);
        } else if (data.type === "message") {
          setMessages((prev) => [...prev.slice(-299), data as AgentMsg]);
        }
      } catch {}
    };

    ws.onclose = () => {
      setStatus("disconnected");
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // 자동 스크롤
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  // 스크롤이 맨 아래 아닐 때 autoScroll 끄기
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  };

  // 활성 에이전트 목록 (최근 메시지 기준)
  const activeAgents = Array.from(
    new Map(
      [...messages].reverse()
        .filter((m) => m.id !== "system")
        .map((m) => [m.id, m])
    ).values()
  ).slice(0, 10);

  const filteredMessages = filter === "all"
    ? messages
    : messages.filter((m) => m.id === filter || m.id === "system");

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-gray-950 text-gray-100 overflow-hidden">

      {/* ── 사이드바: 에이전트 목록 ── */}
      <aside className="hidden lg:flex flex-col w-52 flex-shrink-0 bg-gray-900 border-r border-gray-800">
        <div className="px-4 py-3 border-b border-gray-800">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">에이전트</p>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {/* 전체 보기 */}
          <button
            onClick={() => setFilter("all")}
            className={`w-full text-left px-4 py-2 text-sm transition-colors ${
              filter === "all"
                ? "bg-blue-900/40 text-blue-300"
                : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            }`}
          >
            <span className="mr-2">💬</span>전체 대화
          </button>

          <div className="my-1 mx-4 border-t border-gray-800" />

          {activeAgents.map((a) => (
            <button
              key={a.id}
              onClick={() => setFilter(a.id)}
              className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                filter === a.id
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{a.emoji}</span>
                <div className="min-w-0">
                  <p className="font-medium truncate" style={{ color: a.color }}>
                    {a.name}
                  </p>
                  <p className="text-xs text-gray-600 truncate">
                    {AGENT_INFO[a.id]?.desc ?? ""}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* 서버 상태 */}
        <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-500 space-y-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                status === "connected" ? "bg-green-400 animate-pulse" :
                status === "connecting" ? "bg-yellow-400 animate-pulse" :
                "bg-red-400"
              }`}
            />
            {status === "connected" ? "실시간 연결" :
             status === "connecting" ? "연결 중..." : "연결 끊김"}
          </div>
          <p className="text-gray-700">Gemini 2.0 Flash Lite</p>
        </div>
      </aside>

      {/* ── 메인 채팅 영역 ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* 상단 헤더 */}
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-xl">🧠</span>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-white truncate">AI 에이전트 시황 채팅</h1>
              <p className="text-xs text-gray-500 truncate">
                뉴스·텔레그램·리포트 기반 · 5개 에이전트 실시간 토론
              </p>
            </div>
          </div>

          {/* 모바일 상태 */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className={`w-2 h-2 rounded-full ${
                status === "connected" ? "bg-green-400 animate-pulse" :
                status === "connecting" ? "bg-yellow-400 animate-pulse" :
                "bg-red-400"
              }`}
            />
            <span className="text-xs text-gray-400 hidden sm:block">
              {status === "connected" ? "실시간" :
               status === "connecting" ? "연결 중" : "끊김"}
            </span>
          </div>

          {/* 자동 스크롤 */}
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
              className="flex-shrink-0 px-2 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              ↓ 최신
            </button>
          )}
        </div>

        {/* 채팅 메시지 */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
        >
          {status !== "connected" && messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 gap-4">
              <div className="text-5xl animate-spin">⚙️</div>
              <div>
                <p className="text-base font-medium text-gray-400">서버 연결 중...</p>
                <p className="text-sm mt-1">agents_server.py를 먼저 실행해주세요</p>
                <code className="mt-2 block text-xs bg-gray-800 text-green-400 px-3 py-2 rounded font-mono">
                  python agents_server.py
                </code>
              </div>
            </div>
          ) : (
            filteredMessages.map((msg, i) => {
              const isSystem = msg.id === "system";
              const prev = filteredMessages[i - 1];
              const sameAuthor = prev && prev.id === msg.id && !isSystem;

              if (isSystem) {
                return (
                  <div key={i} className="flex justify-center">
                    <span className="text-xs text-gray-600 bg-gray-900 px-3 py-1 rounded-full border border-gray-800">
                      {msg.emoji} {msg.message}
                    </span>
                  </div>
                );
              }

              return (
                <div key={i} className={`flex gap-3 ${sameAuthor ? "mt-1" : "mt-4"}`}>
                  {/* 아바타 */}
                  {sameAuthor ? (
                    <div className="w-9 flex-shrink-0" />
                  ) : (
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0 border"
                      style={{
                        backgroundColor: msg.color + "20",
                        borderColor: msg.color + "40",
                      }}
                    >
                      {msg.emoji}
                    </div>
                  )}

                  {/* 메시지 내용 */}
                  <div className="flex-1 min-w-0">
                    {!sameAuthor && (
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-sm font-semibold" style={{ color: msg.color }}>
                          {msg.name}
                        </span>
                        <span className="text-xs text-gray-600">
                          {AGENT_INFO[msg.id]?.desc ?? ""}
                        </span>
                        <span className="text-xs text-gray-700 ml-auto">{msg.timestamp}</span>
                      </div>
                    )}
                    <p className="text-sm text-gray-200 leading-relaxed break-words whitespace-pre-wrap">
                      {msg.message}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* 하단 안내 */}
        <div className="px-4 py-2 bg-gray-900 border-t border-gray-800 flex-shrink-0">
          <p className="text-xs text-gray-600 text-center">
            에이전트들이 자동으로 시황을 토론합니다 · 컴퓨터가 켜진 동안 24시간 운영
          </p>
        </div>
      </div>
    </div>
  );
}
