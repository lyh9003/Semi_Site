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

# 랜덤 주제 주입용 - 다음 주입 시각 추적
next_topic_inject: float = 0.0

import re
import time

def strip_html(html: str) -> str:
    """HTML 태그 제거"""
    text = re.sub(r"<[^>]+>", " ", html or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ── 시장 데이터 Fetch (전체 소스) ────────────────────────────────────────────
async def fetch_market_data() -> str:
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    base = SUPABASE_URL.rstrip("/") + "/rest/v1"
    parts = []

    try:
        async with httpx.AsyncClient(timeout=20) as client:

            # ① 최신 뉴스 20건 — 요약 + 본문 앞부분 + 키워드
            r = await client.get(f"{base}/news", headers=headers, params={
                "select": "title,company,summary,content,keyword,date,importance",
                "order": "date.desc,importance.desc",
                "limit": "20",
            })
            if r.status_code == 200 and r.json():
                lines = ["[최신 뉴스 (중요도순)]"]
                for n in r.json():
                    summary = (n.get("summary") or "")[:120]
                    content_head = (n.get("content") or "")[:80]
                    kw = n.get("keyword") or ""
                    imp = "★" * min(int(n.get("importance") or 1), 3)
                    text = summary or content_head
                    line = f"• {imp} {n.get('date','')} [{n.get('company','').strip()}] {text}"
                    if kw:
                        line += f" 키워드:{kw[:40]}"
                    lines.append(line)
                parts.append("\n".join(lines))

            # ② 텔레그램 — 인기 15건 (원문 + 채널명 + 감성)
            r = await client.get(f"{base}/telegram_messages", headers=headers, params={
                "select": "message,summary,keywords,sentiment,channel,forward_count",
                "order": "forward_count.desc,date_utc.desc",
                "limit": "15",
            })
            if r.status_code == 200 and r.json():
                lines = ["[텔레그램 인기 메시지 (공유수순)]"]
                for m in r.json():
                    body = (m.get("summary") or m.get("message") or "")[:120]
                    kw   = (m.get("keywords") or "")[:40]
                    if body:
                        sent  = m.get("sentiment", "?")
                        ch    = m.get("channel", "")
                        fwd   = m.get("forward_count", 1)
                        line  = f"• [{sent}] 공유{fwd}회 [{ch}] {body}"
                        if kw:
                            line += f" #{kw}"
                        lines.append(line)
                parts.append("\n".join(lines))

            # ③ 증권리포트 — 최신 10건 (한줄요약 + 요약본 + 목표주가 + 키워드)
            r = await client.get(f"{base}/stock_reports", headers=headers, params={
                "select": "title,securities_firm,one_line_summary,summary,target_price,keyword,date",
                "order": "date.desc",
                "limit": "10",
            })
            if r.status_code == 200 and r.json():
                lines = ["[증권리포트 (최신순 · 요약 포함)]"]
                for rp in r.json():
                    one     = (rp.get("one_line_summary") or rp.get("title") or "")[:100]
                    summary = (rp.get("summary") or "")[:200]
                    tp      = rp.get("target_price") or ""
                    kw      = (rp.get("keyword") or "")[:40]
                    line = f"• {rp.get('date','')} [{rp.get('securities_firm','')}] {one}"
                    if tp:
                        line += f" TP:{tp}"
                    if kw:
                        line += f" 키워드:{kw}"
                    if summary:
                        line += f"\n  요약: {summary}"
                    lines.append(line)
                parts.append("\n".join(lines))

            # ④ 메모리산업 분석 리포트 (report_pages) — 전 챕터 배경지식
            r = await client.get(f"{base}/report_pages", headers=headers, params={
                "select": "title,content,order_index",
                "order": "order_index.asc",
                "limit": "30",
            })
            if r.status_code == 200 and r.json():
                lines = ["[메모리산업 심층분석 — 배경지식]"]
                for pg in r.json():
                    raw = strip_html(pg.get("content") or "")
                    if raw and len(raw) > 30:
                        snippet = raw[:200]
                        lines.append(f"▶ {pg.get('title','')}: {snippet}")
                parts.append("\n".join(lines))

    except Exception as e:
        print(f"[데이터 fetch 오류] {e}")
        return market_context or "시장 데이터 없음"

    result = "\n\n".join(parts)
    print(f"[데이터] {len(result)}자 로드")
    return result if result else "시장 데이터 없음"


# ── 랜덤 토픽 주입 (대화 다양성) ────────────────────────────────────────────
TOPIC_STARTERS = [
    "지금 HBM 시장에서 SK하이닉스와 삼성전자 격차 어떻게 볼거야?",
    "AI 버블이라는 말이 많은데 진짜 버블이야 아니야?",
    "중국 CXMT가 범용 DRAM 시장 위협하는 거 어느 정도로 심각하게 봐야 해?",
    "지금 반도체 사이클 고점이야 아직 더 올라가?",
    "엔비디아 단일 고객 의존 리스크 어떻게 생각해?",
    "DDR5 전환 속도가 예상보다 빠른데 이게 DRAM 수요에 어떤 영향이야?",
    "요즘 텔레그램에서 핫한 종목 뭐야?",
    "최근 증권사 리포트 중에 제일 눈에 띄는 게 뭐야?",
    "NAND Flash 시장은 언제쯤 회복돼?",
    "삼성전자 지금 매수 타이밍이야 아니야?",
    "연준 금리 인하 속도가 반도체 수요에 미치는 영향은?",
    "메모리 Burn Margin 지금 어느 구간이야?",
]


# ── 논쟁 유발 키워드 (버스트 모드 트리거) ──────────────────────────────────
HOT_KEYWORDS = [
    "틀렸", "아니야", "반대야", "위험해", "버블", "폭락", "급등", "확실해",
    "무조건", "말이 안", "과장", "틀림없", "절대", "이상하다", "의심",
]

def is_hot_message(text: str) -> bool:
    return any(kw in text for kw in HOT_KEYWORDS)


# ── Ollama 메시지 생성 ───────────────────────────────────────────────────────
async def generate_message(agent: Dict, context: str, history: List[Dict]) -> str:
    recent = history[-8:] if len(history) >= 8 else history

    # 마지막 발언 파악
    last_msg = recent[-1] if recent else None
    last_speaker = f"{last_msg['emoji']}{last_msg['name']}" if last_msg else "아무도"
    last_text = last_msg["message"] if last_msg else ""

    history_text = "\n".join(
        f"{m['emoji']}{m['name']}: {m['message']}" for m in recent
    ) if recent else "(대화 시작)"

    # 시장 데이터 — 에이전트별로 랜덤하게 다른 섹션 강조 (다양성)
    ctx_lines = context.split("\n\n")
    random.shuffle(ctx_lines)
    context_for_prompt = "\n\n".join(ctx_lines)[:3500]

    # 논쟁적 발언이면 더 강하게 반응
    hot = is_hot_message(last_text)
    reaction_style = (
        "강하게 찬성하거나 반박하며 논쟁을 이어가세요."
        if hot else
        "자연스럽게 반응하거나 데이터를 근거로 새로운 관점을 던지세요."
    )

    # 에이전트 이름 목록 (본인 제외)
    others = [a["name"] for a in AGENTS if a["id"] != agent["id"]]
    others_str = "·".join(random.sample(others, min(3, len(others))))

    prompt = (
        f"당신은 반도체·주식 채팅방의 '{agent['name']}'입니다.\n"
        f"성격: {agent['role']}\n\n"
        f"=== 시장 데이터 (뉴스·텔레그램·리포트·산업분석) ===\n{context_for_prompt}\n\n"
        f"=== 최근 대화 ===\n{history_text}\n\n"
        f"지금 {last_speaker}가 말했습니다: \"{last_text}\"\n\n"
        f"'{agent['name']}'으로서 위 발언에 반응하세요. {reaction_style}\n"
        f"규칙:\n"
        f"1. 방금 한 말에 직접 반응 우선 (동의·반박·질문·비틀기)\n"
        f"2. 위 시장 데이터에서 구체적 수치·사실을 꺼내 근거로 쓸 것\n"
        f"3. 1~2문장, 진짜 채팅 말투 (구어체)\n"
        f"4. 가끔 {others_str} 등 다른 참여자 이름 직접 호명 가능\n"
        f"5. 본문만 출력 (자기 이름·역할 설명 금지)\n"
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
                        "temperature": 0.9,
                        "top_p": 0.92,
                        "num_predict": 150,
                        "stop": ["\n\n", "---", "===", "규칙"],
                    },
                },
            )
            if r.status_code == 200:
                text = r.json().get("response", "").strip()
                lines = [l.strip() for l in text.split("\n") if l.strip()]
                return " ".join(lines[:2])
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

        # 30틱(약 5분)마다 시장 데이터 갱신
        if tick % 30 == 0:
            market_context = await fetch_market_data()
            print(f"[데이터 갱신] tick={tick} | {len(market_context)}자")

        # 8~12틱(약 90초)마다 랜덤 토픽 주입 — 대화 주제 환기
        if tick % random.randint(8, 12) == 0:
            topic = random.choice(TOPIC_STARTERS)
            injector = random.choice([a for a in AGENTS if a["id"] != "system"])
            topic_msg = {
                "type": "message",
                "id": injector["id"],
                "name": injector["name"],
                "emoji": injector["emoji"],
                "color": injector["color"],
                "message": topic,
                "timestamp": datetime.now().strftime("%H:%M:%S"),
            }
            chat_history.append(topic_msg)
            await manager.broadcast(topic_msg)
            print(f"[토픽주입] {injector['name']}: {topic[:50]}")
            await asyncio.sleep(random.uniform(4, 8))

        # 최근 3명 제외하고 랜덤 선택 (더 다양하게)
        recent_ids = {m["id"] for m in chat_history[-3:] if m.get("id") != "system"}
        candidates = [a for a in AGENTS if a["id"] not in recent_ids]
        agent = random.choice(candidates if candidates else AGENTS)

        real_history = [m for m in chat_history if m.get("id") != "system"]

        print(f"[{agent['emoji']}{agent['name']}] 생성 중...")
        text = await generate_message(agent, market_context, real_history)

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

            # 버스트 모드: 논쟁적 발언이면 2명이 빠르게 연속 반응
            if is_hot_message(text):
                print("[버스트] 논쟁 감지 → 연속 반응")
                for _ in range(2):
                    await asyncio.sleep(random.uniform(4, 9))
                    burst_ids = {m["id"] for m in chat_history[-3:] if m.get("id") != "system"}
                    burst_pool = [a for a in AGENTS if a["id"] not in burst_ids]
                    burst_agent = random.choice(burst_pool if burst_pool else AGENTS)
                    burst_hist = [m for m in chat_history if m.get("id") != "system"]
                    burst_text = await generate_message(burst_agent, market_context, burst_hist)
                    if burst_text:
                        burst_msg = {
                            "type": "message",
                            "id": burst_agent["id"],
                            "name": burst_agent["name"],
                            "emoji": burst_agent["emoji"],
                            "color": burst_agent["color"],
                            "message": burst_text,
                            "timestamp": datetime.now().strftime("%H:%M:%S"),
                        }
                        chat_history.append(burst_msg)
                        await manager.broadcast(burst_msg)
                        print(f"  [버스트] {burst_agent['name']}: {burst_text[:50]}...")
                        if is_hot_message(burst_text):
                            break  # 연쇄 폭발 방지

        # 기본 대기: 8~18초 (빠른 대화 속도)
        delay = random.uniform(8, 18)
        await asyncio.sleep(delay)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="info")
