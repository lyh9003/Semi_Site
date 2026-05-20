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
OLLAMA_MODEL  = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")

# ── 에이전트 페르소나 10개 (개성·말투·관심분야 강화) ─────────────────────────
AGENTS = [
    {
        "id": "bull", "name": "황소", "emoji": "🐂", "color": "#16a34a",
        "focus": ["news", "reports"],
        "voice": (
            "극도의 낙관론자. 말투: '이거 진짜임', '무조건 간다', '봐봐 이 수치', "
            "'올해 안에 무조건' 같은 확신에 찬 표현. "
            "반박당하면 더 강하게 근거를 들이밀고, 약세론자를 비웃음."
        ),
        "mode_weights": {"share": 3, "challenge": 3, "react": 2, "question": 1},
    },
    {
        "id": "bear", "name": "곰", "emoji": "🐻", "color": "#dc2626",
        "focus": ["telegram", "analysis"],
        "voice": (
            "냉소적 비관론자. 말투: '됐고', '그래서 뭐가 좋다는 거야', '전형적인 낙관 편향', "
            "'리스크는 얘기 안 하네'. 짧고 날카롭게 반박. "
            "낙관론자 말이 끝나면 바로 뒤집으려 함."
        ),
        "mode_weights": {"challenge": 4, "react": 3, "share": 1, "question": 1},
    },
    {
        "id": "chart", "name": "차트맨", "emoji": "📊", "color": "#7c3aed",
        "focus": ["news", "telegram"],
        "voice": (
            "기술적 분석 집착. 말투: '20일선이', 'RSI 과매수권', '저항선 돌파 여부가 관건', "
            "'이 패턴은 전형적인 헤드앤숄더'. 숫자와 차트 얘기만 함. "
            "펀더멘털 얘기엔 '차트가 다야' 라고 받아침."
        ),
        "mode_weights": {"share": 3, "react": 3, "challenge": 2, "question": 1},
    },
    {
        "id": "funda", "name": "펀더", "emoji": "🔬", "color": "#0369a1",
        "focus": ["reports", "analysis"],
        "voice": (
            "조용하지만 확고한 가치투자자. 말투: '그보다 중요한 건 실적이고', "
            "'PBR 0.8배면 역사적 저점이잖아', '5년 뒤를 봐야지'. "
            "단기 노이즈엔 무덤덤하고, 장기 본질 가치만 얘기함."
        ),
        "mode_weights": {"share": 3, "react": 2, "challenge": 2, "question": 2},
    },
    {
        "id": "macro", "name": "매크로", "emoji": "🌍", "color": "#b45309",
        "focus": ["news", "analysis"],
        "voice": (
            "글로벌 시각의 거시 분석가. 말투: '연준이 이러면', '달러 강세가 변수야', "
            "'중국 경기 봐야지', '지정학 리스크가 간과되고 있어'. "
            "개별 종목보단 매크로 환경이 다 결정한다고 봄."
        ),
        "mode_weights": {"share": 4, "react": 2, "challenge": 2, "question": 1},
    },
    {
        "id": "reporter", "name": "기자", "emoji": "📰", "color": "#0f766e",
        "focus": ["news", "telegram"],
        "voice": (
            "속보 전문 기자. 말투: '방금 뉴스 떴는데', '공시 나왔어', "
            "'시장 반응이 이상하게 조용한데', '이거 모르는 사람 많을 듯'. "
            "새 정보를 제일 먼저 꺼내고, 의미를 빠르게 해석함."
        ),
        "mode_weights": {"share": 5, "react": 2, "challenge": 1, "question": 1},
    },
    {
        "id": "analyst", "name": "애널리", "emoji": "📋", "color": "#9333ea",
        "focus": ["reports"],
        "voice": (
            "증권사 리포트 신봉자. 말투: '키움이 목표주가 올렸는데', "
            "'컨센서스가 이미 반영됐지', '리포트 보면 분명히 나와있어'. "
            "반드시 증권사 리포트나 수치를 인용해서 말함."
        ),
        "mode_weights": {"share": 4, "react": 3, "challenge": 2, "question": 0},
    },
    {
        "id": "quant", "name": "퀀트", "emoji": "🤖", "color": "#0891b2",
        "focus": ["reports", "analysis"],
        "voice": (
            "감정 없는 데이터 로봇. 말투: '통계적으로', '백테스트 결과', "
            "'이 팩터의 IR이', '유의미하지 않아'. 확률과 수치만 씀. "
            "사람들 감정적 판단을 데이터로 반박하는 걸 즐김."
        ),
        "mode_weights": {"challenge": 3, "share": 3, "react": 2, "question": 1},
    },
    {
        "id": "risk", "name": "리스크", "emoji": "🛡️", "color": "#be123c",
        "focus": ["telegram", "news"],
        "voice": (
            "재앙 예언자. 말투: '잠깐', '다들 이걸 간과하는데', '꼬리위험이', "
            "'2008년에도 이랬어', '포지션 줄여야 할 것 같은데'. "
            "모두가 낙관적일수록 더 강하게 경고함."
        ),
        "mode_weights": {"challenge": 4, "share": 2, "react": 3, "question": 0},
    },
    {
        "id": "retail", "name": "개미", "emoji": "🐜", "color": "#854d0e",
        "focus": ["news", "telegram"],
        "voice": (
            "순수한 개인투자자. 말투: '그래서 사야 해요?', '저도 들어갔는데 ㅠ', "
            "'이거 무슨 말이에요', '반도체 ETF 사면 되나요?'. "
            "전문 용어 나오면 바로 질문하고, 손실 볼까봐 항상 불안함."
        ),
        "mode_weights": {"question": 5, "react": 3, "share": 1, "challenge": 0},
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


import re
import time

manager = ConnectionManager()
chat_history: List[Dict] = []
market_data: Dict[str, List[str]] = {"news": [], "telegram": [], "reports": [], "analysis": []}

def strip_html(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html or "")
    return re.sub(r"\s+", " ", text).strip()


# ── 시장 데이터 Fetch — 카테고리별 리스트로 반환 ────────────────────────────
async def fetch_market_data() -> Dict[str, List[str]]:
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    base = SUPABASE_URL.rstrip("/") + "/rest/v1"
    result: Dict[str, List[str]] = {"news": [], "telegram": [], "reports": [], "analysis": []}

    try:
        async with httpx.AsyncClient(timeout=20) as client:

            # ① 뉴스 30건 → 항목별 문자열 리스트
            r = await client.get(f"{base}/news", headers=headers, params={
                "select": "title,company,summary,content,keyword,date,importance",
                "order": "date.desc,importance.desc",
                "limit": "30",
            })
            if r.status_code == 200:
                for n in r.json():
                    body = (n.get("summary") or n.get("content") or n.get("title") or "")[:150]
                    kw   = (n.get("keyword") or "")[:40]
                    imp  = "★" * min(int(n.get("importance") or 1), 3)
                    s = f"{imp} [{n.get('date','')}] {n.get('company','').strip()}: {body}"
                    if kw:
                        s += f" (키워드: {kw})"
                    result["news"].append(s)

            # ② 텔레그램 30건 → 항목별 문자열 리스트
            r = await client.get(f"{base}/telegram_messages", headers=headers, params={
                "select": "message,summary,keywords,sentiment,channel,forward_count",
                "order": "forward_count.desc,date_utc.desc",
                "limit": "30",
            })
            if r.status_code == 200:
                for m in r.json():
                    body = (m.get("summary") or m.get("message") or "")[:150]
                    if not body:
                        continue
                    kw  = (m.get("keywords") or "")[:40]
                    s = f"[{m.get('sentiment','?')}] 공유{m.get('forward_count',1)}회 [{m.get('channel','')}]: {body}"
                    if kw:
                        s += f" #{kw}"
                    result["telegram"].append(s)

            # ③ 증권리포트 20건 → 항목별 문자열 리스트
            r = await client.get(f"{base}/stock_reports", headers=headers, params={
                "select": "title,securities_firm,one_line_summary,summary,target_price,keyword,date",
                "order": "date.desc",
                "limit": "20",
            })
            if r.status_code == 200:
                for rp in r.json():
                    one  = (rp.get("one_line_summary") or rp.get("title") or "")[:100]
                    summ = (rp.get("summary") or "")[:150]
                    tp   = rp.get("target_price") or ""
                    kw   = (rp.get("keyword") or "")[:40]
                    s = f"[{rp.get('date','')}] {rp.get('securities_firm','')}: {one}"
                    if tp:
                        s += f" 목표주가:{tp}"
                    if kw:
                        s += f" 키워드:{kw}"
                    if summ:
                        s += f" | {summ}"
                    result["reports"].append(s)

            # ④ 메모리산업 분석 챕터 → 항목별 문자열 리스트
            r = await client.get(f"{base}/report_pages", headers=headers, params={
                "select": "title,content,order_index",
                "order": "order_index.asc",
                "limit": "30",
            })
            if r.status_code == 200:
                for pg in r.json():
                    raw = strip_html(pg.get("content") or "")
                    if raw and len(raw) > 50:
                        s = f"[메모리산업분석] {pg.get('title','')}: {raw[:250]}"
                        result["analysis"].append(s)

    except Exception as e:
        print(f"[데이터 fetch 오류] {e}")
        return market_data  # 이전 데이터 유지

    total = sum(len(v) for v in result.values())
    print(f"[데이터] 뉴스{len(result['news'])}건 텔레그램{len(result['telegram'])}건 리포트{len(result['reports'])}건 분석{len(result['analysis'])}건 (총{total}항목)")
    return result


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

def pick_agent_mode(agent: Dict) -> str:
    """에이전트 성향에 따라 가중치로 대화 모드 선택"""
    weights = agent.get("mode_weights", {"react": 3, "share": 2, "challenge": 2, "question": 1})
    modes   = list(weights.keys())
    counts  = list(weights.values())
    return random.choices(modes, weights=counts, k=1)[0]

def pick_data_for_agent(agent: Dict, data: Dict[str, List[str]]) -> str:
    """에이전트 관심 분야에서 랜덤 2~3개 항목만 추출"""
    focus = agent.get("focus", ["news"])
    cat   = random.choice(focus)
    items = data.get(cat, [])
    if not items:
        # 폴백: 다른 카테고리에서
        for c in ["news", "telegram", "reports", "analysis"]:
            if data.get(c):
                items = data[c]
                break
    if not items:
        return "데이터 없음"
    picked = random.sample(items, min(3, len(items)))
    return "\n".join(picked)


# ── 대화 모드별 지시문 ────────────────────────────────────────────────────────
MODE_INSTRUCTIONS = {
    "react": (
        "방금 {speaker}가 한 말 \"{last}\"에 직접 반응하세요. "
        "동의하거나 반박하거나 비틀어서."
    ),
    "share": (
        "아래 데이터에서 흥미로운 사실 하나를 꺼내 대화에 던지세요. "
        "\"방금 뉴스 봤는데\", \"리포트에 나왔는데\" 식으로 자연스럽게."
    ),
    "challenge": (
        "{speaker}의 말 \"{last}\"이 틀렸다고 반박하세요. "
        "데이터를 근거로 구체적으로."
    ),
    "question": (
        "대화 흐름을 보고 궁금한 걸 질문하세요. "
        "특정 에이전트를 지목해서 답을 요구해도 됨."
    ),
}


# ── Ollama 메시지 생성 ───────────────────────────────────────────────────────
async def generate_message(agent: Dict, data: Dict[str, List[str]], history: List[Dict]) -> str:
    recent = history[-6:] if len(history) >= 6 else history

    last_msg     = recent[-1] if recent else None
    last_speaker = f"{last_msg['emoji']}{last_msg['name']}" if last_msg else "아무도"
    last_text    = last_msg["message"] if last_msg else ""

    history_text = "\n".join(
        f"{m['emoji']}{m['name']}: {m['message']}" for m in recent
    ) if recent else "(대화 시작)"

    # 에이전트별 특화 데이터 조각
    data_snippet = pick_data_for_agent(agent, data)

    # 대화 모드 선택
    mode         = pick_agent_mode(agent)
    instruction  = MODE_INSTRUCTIONS[mode].format(speaker=last_speaker, last=last_text[:60])

    # 호명할 상대 랜덤 선택
    others     = [a["name"] for a in AGENTS if a["id"] != agent["id"]]
    target     = random.choice(others)

    prompt = (
        f"너는 한국 반도체·주식 채팅방의 '{agent['name']}'야.\n"
        f"성격: {agent['voice']}\n\n"
        f"시장 데이터:\n{data_snippet}\n\n"
        f"최근 대화:\n{history_text}\n\n"
        f"지시: {instruction}\n\n"
        f"규칙 (반드시 지킬 것):\n"
        f"1. 한국어로만 답변 (중국어·영어 절대 금지)\n"
        f"2. 1~2문장, 반말 채팅체\n"
        f"3. '{agent['name']}:' 같은 자기 이름 출력 금지\n"
        f"4. 가끔 '{target}'를 이름으로 부를 것\n"
        f"답변:"
    )

    def has_cjk(text: str) -> bool:
        """중국어/일본어 한자 포함 여부 (한국 한자 제외)"""
        return bool(re.search(r"[一-鿿぀-ヿ]", text))

    for attempt in range(2):  # 중국어 섞이면 1회 재시도
        try:
            async with httpx.AsyncClient(timeout=35) as client:
                r = await client.post(
                    f"{OLLAMA_URL}/api/generate",
                    json={
                        "model": OLLAMA_MODEL,
                        "prompt": prompt,
                        "stream": False,
                        "options": {
                            "temperature": 0.85 + attempt * 0.05,
                            "top_p": 0.9,
                            "num_predict": 120,
                            "stop": ["\n\n", "규칙:", "시장 데이터:", "최근 대화:"],
                        },
                    },
                )
                if r.status_code == 200:
                    text = r.json().get("response", "").strip()
                    # "답변:" 접두어 제거
                    text = re.sub(r"^답변[:：]?\s*", "", text).strip()
                    # 자기 이름 접두어 제거 (예: "황소: ...")
                    text = re.sub(rf"^{re.escape(agent['name'])}[:：]\s*", "", text).strip()
                    lines = [l.strip() for l in text.split("\n") if l.strip()]
                    result = " ".join(lines[:2])
                    if result and not has_cjk(result):
                        return result
                    print(f"  [재시도] 한자 감지: {result[:30]}")
        except httpx.TimeoutException:
            print(f"  [타임아웃] {agent['name']} 35초 초과 → 건너뜀")
            return ""
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
    global market_data
    tick = 0

    print(f"[시작] 모델={OLLAMA_MODEL} | 포트=8765")
    market_data = await fetch_market_data()

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
            market_data = await fetch_market_data()

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
        text = await generate_message(agent, market_data, real_history)

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

            # 버스트 모드: 논쟁적 발언이면 1명이 빠르게 반응 (7B 속도 고려해 1회만)
            if is_hot_message(text):
                print("[버스트] 논쟁 감지 → 1명 추가 반응")
                await asyncio.sleep(random.uniform(3, 6))
                burst_ids = {m["id"] for m in chat_history[-3:] if m.get("id") != "system"}
                burst_pool = [a for a in AGENTS if a["id"] not in burst_ids]
                burst_agent = random.choice(burst_pool if burst_pool else AGENTS)
                burst_hist = [m for m in chat_history if m.get("id") != "system"]
                print(f"  [버스트] {burst_agent['name']} 생성 중...")
                burst_text = await generate_message(burst_agent, market_data, burst_hist)
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

        # 기본 대기: 8~18초 (빠른 대화 속도)
        delay = random.uniform(8, 18)
        await asyncio.sleep(delay)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="info")
