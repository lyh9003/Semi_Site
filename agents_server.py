"""
에이전트 시황 채팅 서버
- FastAPI WebSocket 서버 (포트 8765)
- 10개 에이전트가 Qwen2.5:3b (Ollama)로 실시간 시황 토론
- Supabase에서 뉴스·텔레그램·증권리포트 데이터 자동 갱신 (5분마다)
"""

import asyncio
import json
import random
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Dict

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# Windows 콘솔 UTF-8 강제 (cp949 인코딩 오류 방지)
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr.encoding != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ── 환경변수 (.env.local 읽기) ──────────────────────────────────────────────
def load_env(path=".env.local"):
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass

load_env(os.path.join(os.path.dirname(__file__), ".env.local"))

SUPABASE_URL  = os.getenv("NEXT_PUBLIC_SUPABASE_URL",  "https://zpfcxfzxqpprtcjmzosc.supabase.co")
SUPABASE_KEY  = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
OLLAMA_URL    = os.getenv("OLLAMA_URL",   "http://localhost:11434")
OLLAMA_MODEL  = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")

# ── 에이전트 페르소나 10개 ───────────────────────────────────────────────────
AGENTS = [
    {
        "id": "bull", "name": "황소", "emoji": "🐂", "color": "#16a34a",
        "role": (
            "강세론자. 시장의 긍정적 신호와 상승 모멘텀에 집중하는 낙관주의자다. "
            "데이터에서 기회를 발굴하고 확신 있게 매수 논거를 제시한다. "
            "약세론자의 주장엔 반박한다."
        ),
    },
    {
        "id": "bear", "name": "곰", "emoji": "🐻", "color": "#dc2626",
        "role": (
            "약세론자. 시장의 리스크와 과대평가를 경계하는 냉정한 비관주의자다. "
            "하락 가능성과 꼬리위험을 구체적 근거로 분석한다. "
            "강세론 주장을 날카롭게 반박한다."
        ),
    },
    {
        "id": "chart", "name": "차트맨", "emoji": "📊", "color": "#7c3aed",
        "role": (
            "기술적 분석가. 이동평균선, RSI, MACD, 볼린저밴드 등 기술적 지표로 "
            "시장 방향을 판단한다. 숫자와 패턴에 근거한 발언을 선호한다."
        ),
    },
    {
        "id": "funda", "name": "펀더", "emoji": "🔬", "color": "#0369a1",
        "role": (
            "펀더멘털 분석가. 기업 실적, PER, PBR, 배당수익률, 영업이익률로 "
            "내재가치를 계산한다. 단기 변동보다 장기 가치에 집중한다."
        ),
    },
    {
        "id": "macro", "name": "매크로", "emoji": "🌍", "color": "#b45309",
        "role": (
            "거시경제 분석가. 연준 금리, 환율, 인플레이션, 글로벌 무역 흐름이 "
            "반도체·주식시장에 미치는 영향을 분석한다. 빅픽처 관점을 제공한다."
        ),
    },
    {
        "id": "reporter", "name": "기자", "emoji": "📰", "color": "#0f766e",
        "role": (
            "뉴스 해설가. 최신 공시·뉴스를 빠르게 해석하고 시장 반응을 예측한다. "
            "팩트에 기반한 간결한 정보 전달이 특기다. "
            "방금 나온 뉴스를 언급하며 대화를 이어간다."
        ),
    },
    {
        "id": "analyst", "name": "애널리", "emoji": "📋", "color": "#9333ea",
        "role": (
            "증권리포트 분석가. 증권사 리포트의 투자의견, 목표주가, 핵심 논거를 "
            "정리하고 컨센서스를 분석한다. 리포트 내용을 인용해 논리를 강화한다."
        ),
    },
    {
        "id": "quant", "name": "퀀트", "emoji": "🤖", "color": "#0891b2",
        "role": (
            "퀀트 분석가. 수익률 통계, 팩터 분석, 백테스트 결과로 냉정하게 판단한다. "
            "감정 없이 데이터와 확률로 말한다. "
            "수치를 제시하며 대화에 근거를 더한다."
        ),
    },
    {
        "id": "risk", "name": "리스크", "emoji": "🛡️", "color": "#be123c",
        "role": (
            "리스크 매니저. 블랙스완, 상관관계 붕괴, 변동성 스파이크, 유동성 위험을 "
            "경계한다. 모두가 낙관적일 때 꼬리위험을 상기시킨다. "
            "헷지 전략과 손절 기준을 제안한다."
        ),
    },
    {
        "id": "retail", "name": "개미", "emoji": "🐜", "color": "#854d0e",
        "role": (
            "개인투자자. 복잡한 시장을 쉬운 말로 이해하려는 일반 투자자다. "
            "솔직한 궁금증과 현실적인 고민을 공유한다. "
            "전문가 용어가 나오면 쉽게 물어본다."
        ),
    },
]

# ── WebSocket 연결 관리 ──────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.connections: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.connections:
            self.connections.remove(ws)

    async def broadcast(self, data: dict):
        payload = json.dumps(data, ensure_ascii=False)
        dead = []
        for ws in self.connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()
chat_history: List[Dict] = []
market_context: str = ""

# ── 시장 데이터 Fetch ────────────────────────────────────────────────────────
async def fetch_market_data() -> str:
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    base = SUPABASE_URL.rstrip("/") + "/rest/v1"
    parts = []

    try:
        async with httpx.AsyncClient(timeout=15) as client:

            # 최신 뉴스 10건
            r = await client.get(f"{base}/news", headers=headers, params={
                "select": "title,company,summary,date,keyword",
                "order": "date.desc,importance.desc",
                "limit": "10",
            })
            if r.status_code == 200 and r.json():
                lines = ["[최신 뉴스]"]
                for n in r.json():
                    s = (n.get("summary") or n.get("title") or "")[:90]
                    lines.append(f"• {n.get('date','')} {n.get('company','').strip()}: {s}")
                parts.append("\n".join(lines))

            # 인기 텔레그램 메시지 10건
            r = await client.get(f"{base}/telegram_messages", headers=headers, params={
                "select": "summary,keywords,sentiment,channel",
                "order": "forward_count.desc,date_utc.desc",
                "limit": "10",
            })
            if r.status_code == 200 and r.json():
                lines = ["[텔레그램 주요 메시지]"]
                for m in r.json():
                    s = (m.get("summary") or "")[:90]
                    if s:
                        lines.append(f"• [{m.get('sentiment','?')}] {s}")
                parts.append("\n".join(lines))

            # 최신 증권리포트 5건
            r = await client.get(f"{base}/stock_reports", headers=headers, params={
                "select": "title,securities_firm,one_line_summary,date",
                "order": "date.desc",
                "limit": "5",
            })
            if r.status_code == 200 and r.json():
                lines = ["[최신 증권리포트]"]
                for rp in r.json():
                    s = (rp.get("one_line_summary") or rp.get("title") or "")[:90]
                    lines.append(f"• {rp.get('date','')} [{rp.get('securities_firm','')}] {s}")
                parts.append("\n".join(lines))

    except Exception as e:
        print(f"[데이터 fetch 오류] {e}")
        return market_context or "시장 데이터 없음"

    return "\n\n".join(parts) if parts else "시장 데이터 없음"


# ── Ollama 메시지 생성 ───────────────────────────────────────────────────────
async def generate_message(agent: Dict, context: str, history: List[Dict]) -> str:
    recent = history[-6:] if len(history) >= 6 else history
    history_text = "\n".join(
        f"{m['emoji']}{m['name']}: {m['message']}" for m in recent
    ) if recent else "(대화 시작)"

    prompt = (
        f"당신은 반도체·주식 시황 채팅방 참여자 '{agent['name']}'입니다.\n"
        f"성격·역할: {agent['role']}\n\n"
        f"=== 현재 시장 데이터 ===\n{context}\n\n"
        f"=== 최근 대화 ===\n{history_text}\n\n"
        "위 정보를 바탕으로, 당신의 역할과 성격에 맞게 시황 코멘트를 한국어로 작성하세요.\n"
        "규칙:\n"
        "- 반드시 2~3문장 이내\n"
        "- 다른 참여자의 말에 동의·반박·질문하거나 새로운 관점 제시\n"
        "- 자연스러운 구어체 (채팅 말투)\n"
        "- 이름이나 역할 설명 없이 본문만 출력\n"
    )

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.85,
                        "top_p": 0.9,
                        "num_predict": 180,
                        "stop": ["\n\n", "==="],
                    },
                },
            )
            if r.status_code == 200:
                text = r.json().get("response", "").strip()
                # 첫 줄만 사용 (프롬프트가 누출될 경우 방어)
                lines = [l.strip() for l in text.split("\n") if l.strip()]
                return " ".join(lines[:3])
    except Exception as e:
        print(f"[Ollama 오류] {e}")
    return ""


# ── FastAPI 앱 ───────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(agent_loop())
    yield

app = FastAPI(title="에이전트 시황 채팅 서버", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    # 접속 시 히스토리 전송
    await websocket.send_text(json.dumps(
        {"type": "history", "messages": chat_history[-50:]},
        ensure_ascii=False,
    ))
    try:
        while True:
            await websocket.receive_text()  # ping 수신 유지
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "agents": len(AGENTS),
        "history": len(chat_history),
        "model": OLLAMA_MODEL,
        "clients": len(manager.connections),
    }


# ── 에이전트 루프 ────────────────────────────────────────────────────────────
async def agent_loop():
    global market_context
    tick = 0

    print(f"[시작] 모델={OLLAMA_MODEL} | 포트=8765")
    market_context = await fetch_market_data()
    print(f"[데이터 로드] {len(market_context)}자")

    # 오프닝 시스템 메시지
    opening = {
        "type": "message",
        "id": "system",
        "name": "시스템",
        "emoji": "🔔",
        "color": "#64748b",
        "message": "에이전트 시황 채팅방이 시작되었습니다. 10명의 에이전트가 실시간으로 시황을 토론합니다.",
        "timestamp": datetime.now().strftime("%H:%M:%S"),
    }
    chat_history.append(opening)
    await manager.broadcast(opening)

    while True:
        tick += 1

        # 5분(20틱 × 15초)마다 데이터 갱신
        if tick % 20 == 0:
            market_context = await fetch_market_data()
            print(f"[데이터 갱신] tick={tick} | {len(market_context)}자")

            refresh_msg = {
                "type": "message",
                "id": "system",
                "name": "시스템",
                "emoji": "🔄",
                "color": "#64748b",
                "message": f"시장 데이터가 갱신되었습니다. (뉴스·텔레그램·리포트 최신화)",
                "timestamp": datetime.now().strftime("%H:%M:%S"),
            }
            chat_history.append(refresh_msg)
            await manager.broadcast(refresh_msg)

        # 최근 2명 제외하고 랜덤 선택
        recent_ids = {m["id"] for m in chat_history[-2:] if m.get("id") != "system"}
        candidates = [a for a in AGENTS if a["id"] not in recent_ids]
        agent = random.choice(candidates if candidates else AGENTS)

        print(f"[{agent['emoji']}{agent['name']}] 생성 중...")
        text = await generate_message(agent, market_context, [
            m for m in chat_history if m.get("id") != "system"
        ])

        if text:
            msg = {
                "type": "message",
                "id": agent["id"],
                "name": agent["name"],
                "emoji": agent["emoji"],
                "color": agent["color"],
                "message": text,
                "timestamp": datetime.now().strftime("%H:%M:%S"),
            }
            chat_history.append(msg)
            if len(chat_history) > 300:
                chat_history.pop(0)
            await manager.broadcast(msg)
            print(f"  → {text[:60]}...")

        # 18~40초 랜덤 대기 (Qwen2.5 3B 속도 고려)
        delay = random.randint(18, 40)
        await asyncio.sleep(delay)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="info")
