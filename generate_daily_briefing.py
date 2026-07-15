"""
일자별 시황 자동 생성 스크립트
KST 기준 오늘 날짜로 briefing 생성 → daily_situation 테이블에 upsert
"""

import os, re, json, sys
from datetime import datetime, timezone, timedelta
import httpx

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SERVICE_KEY  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ANON_KEY     = os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
OPENAI_KEY   = os.environ["OPENAI_API_KEY"]
VERCEL_URL   = os.environ.get("VERCEL_URL", "https://semi-site.vercel.app")

KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST).strftime("%Y-%m-%d")
TODAY_LABEL = datetime.now(KST).strftime("%Y년 %m월 %d일")

HDR_ANON    = {"apikey": ANON_KEY,    "Authorization": f"Bearer {ANON_KEY}"}
HDR_SERVICE = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}

# ── 뉴스 폴백 조회 ─────────────────────────────────────────────────────────────
def fetch_news():
    base = f"{SUPABASE_URL}/rest/v1/news?select=title,company,date,summary,keyword"
    r = httpx.get(f"{SUPABASE_URL}/rest/v1/news?select=date&order=date.desc&limit=1", headers=HDR_ANON)
    rows = r.json()
    if not rows: return []
    d = rows[0]["date"]

    for imp in [3, 2]:
        r2 = httpx.get(f"{base}&importance=eq.{imp}&date=eq.{d}&order=date.desc&limit=10", headers=HDR_ANON)
        data = r2.json()
        if data: return data

    r3 = httpx.get(f"{SUPABASE_URL}/rest/v1/news?select=date&date=lt.{d}&order=date.desc&limit=1", headers=HDR_ANON)
    prev = r3.json()
    if not prev: return []
    pd = prev[0]["date"]
    r4 = httpx.get(f"{base}&importance=eq.3&date=eq.{pd}&order=date.desc&limit=10", headers=HDR_ANON)
    return r4.json() if r4.status_code == 200 else []

# ── 지식 그래프 핫 컨텍스트 ────────────────────────────────────────────────────
def fetch_hot_context():
    try:
        r = httpx.get(f"{VERCEL_URL}/api/graph/hot-context", timeout=30)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"hot-context 조회 실패: {e}")
    return None

# ── 주가 조회 (Yahoo Finance) ──────────────────────────────────────────────────
def fetch_stock(ticker, name, is_index=False):
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=5d"
        r = httpx.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        if r.status_code != 200:
            return None
        result = r.json().get("chart", {}).get("result", [None])[0]
        if not result:
            return None
        raw_price = result["meta"].get("regularMarketPrice", 0)
        # Yahoo Finance meta가 전일 종가를 직접 제공 — 복잡한 closes 배열 파싱 불필요
        prev = result["meta"].get("chartPreviousClose") or result["meta"].get("regularMarketPreviousClose") or 0
        change = round((raw_price - prev) / prev * 100, 2) if prev else 0
        if is_index:
            price = f"{raw_price:,.2f}"
        else:
            price = f"{round(raw_price):,}"
        return {"name": name, "price": price, "change": change}
    except Exception as e:
        print(f"주가 조회 실패 ({ticker}): {e}")
        return None

# ── 브리핑 생성 ────────────────────────────────────────────────────────────────
def generate_briefing():
    news      = fetch_news()
    reports   = httpx.get(f"{SUPABASE_URL}/rest/v1/stock_reports?select=title,securities_firm,date,summary&order=date.desc&limit=5", headers=HDR_ANON).json()
    telegrams = httpx.get(f"{SUPABASE_URL}/rest/v1/telegram_messages?select=channel,summary,date_utc,sentiment&order=date_utc.desc,forward_count.desc&limit=10", headers=HDR_ANON).json()
    hot_ctx   = fetch_hot_context()
    stocks    = [
        fetch_stock("%5EKS11", "코스피", is_index=True),
        fetch_stock("005930.KS", "삼성전자"),
        fetch_stock("000660.KS", "SK하이닉스"),
    ]

    ctx = []
    for t in telegrams:
        ctx.append(f"[텔레그램] ({(t.get('date_utc') or '')[:10]}) {t.get('channel','')} [{t.get('sentiment','중립')}]\n{t.get('summary','')}")
    if hot_ctx and hot_ctx.get("promptText"):
        ctx.append(hot_ctx["promptText"])
    for r in reports:
        ctx.append(f"[리포트] ({r.get('date','')}) {r.get('title','')} — {r.get('securities_firm','')}\n{r.get('summary','')}")
    for n in news:
        ctx.append(f"[뉴스] ({n.get('date','')}) {n.get('title','')}{' — ' + n['company'] if n.get('company') else ''}\n{n.get('summary','')}")

    body = {
        "model": "gpt-4.1",
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": f"""너는 한국 반도체·주식 시황 브리핑 전문가야.
오늘({TODAY_LABEL}) 최신 뉴스·리포트·텔레그램을 분석해서 JSON으로 응답해.

JSON 형식:
{{
  "weather": {{"emoji": "<날씨 이모지>", "label": "<날씨 이름>", "reason": "<한 문장>"}},
  "causal_chains": ["이벤트: A → 섹터: B → 기업: C, D → 지표: E 형태, 1~3개"],
  "new_alerts": ["최근 이슈: <엔티티명>(<타입>)" 형태, 있을 때만 포함],
  "briefing": "<브리핑 전문>"
}}

날씨 기준 (6개 중 하나):
- {{"emoji":"☀️","label":"맑음"}} — 전반적 강세
- {{"emoji":"🌤️","label":"구름 조금"}} — 긍정적이나 일부 불확실성
- {{"emoji":"⛅","label":"흐림"}} — 혼조세
- {{"emoji":"🌧️","label":"비"}} — 약세
- {{"emoji":"⛈️","label":"폭풍"}} — 급락·리스크 급등
- {{"emoji":"🌫️","label":"안개"}} — 극도의 불확실성

리스크 민감도 원칙:
- 긍정·부정 신호가 혼재할 때는 날씨를 한 단계 더 부정적으로 판단 (예: '구름 조금' 대신 '흐림')
- 수요 둔화, 재고 증가, 가격 하락, 고객사 발주 축소, 지정학 리스크 등 부정적 신호는 반드시 명시
- briefing 핵심 요약 첫 문장에 리스크 요인을 먼저 언급
- 시사점에는 하방 리스크 또는 투자 주의 포인트를 한 문장 이상 포함

causal_chains: 그래프 인과 클러스터 정보를 자연어로 정리. 지식 그래프에 없으면 [] 반환.
new_alerts: 최근 이슈 엔티티를 뉴스 맥락에서 해석해 주의 멘트 포함. 없으면 [] 반환.

briefing 형식:
📌 **핵심 요약** (4~5문장, 뉴스·리포트·텔레그램 내용 우선 반영)
📈 **주목 이슈** (5가지, 각 2~3문장, 뉴스·리포트·텔레그램 내용 우선 반영)
🔍 **주목 키워드** (8~12개, 뉴스·리포트·텔레그램에서 추출)
💡 **시사점** (2~3문장)"""},
            {"role": "user", "content": f"오늘({TODAY_LABEL}) 자료:\n\n" + "\n\n".join(ctx)}
        ],
        "max_tokens": 1500,
        "temperature": 0.3,
    }

    r = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"},
        json=body,
        timeout=60
    )
    r.raise_for_status()
    raw = json.loads(r.json()["choices"][0]["message"]["content"])
    return (
        raw.get("briefing", ""),
        raw.get("weather", {"emoji": "⛅", "label": "흐림", "reason": ""}),
        raw.get("causal_chains", []),
        raw.get("new_alerts", []),
        stocks,
    )

# ── 텍스트 → HTML 변환 ─────────────────────────────────────────────────────────
SECTION_STARTERS = ("📌", "📈", "🔍", "💡")

def to_html(text, weather_emoji, weather_label, weather_reason, causal_chains=None, new_alerts=None, stocks=None):
    parts = [
        f'<p style="font-size:1rem;font-weight:700;margin-bottom:0.75rem">'
        f'{weather_emoji} 오늘의 시황 날씨: <strong>{weather_label}</strong>'
        f'{" — " + weather_reason if weather_reason else ""}</p>'
    ]

    # 주가
    valid_stocks = [s for s in (stocks or []) if s]
    if valid_stocks:
        items = []
        for s in valid_stocks:
            c = s["change"]
            color = "#dc2626" if c > 0 else "#2563eb" if c < 0 else "#64748b"
            sign = "+" if c >= 0 else ""
            items.append(f'<span style="white-space:nowrap"><strong>{s["name"]}</strong> {s["price"]} <span style="color:{color}">{sign}{c}%</span></span>')
        parts.append(f'<div style="display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:0.75rem;font-size:0.82rem;color:#334155">{"".join(items)}</div>')

    # 최근 이슈
    if new_alerts:
        badges = "".join(f'<span style="display:inline-block;font-size:0.75rem;font-weight:600;padding:0.15rem 0.6rem;border-radius:9999px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d">⚡ {a}</span>' for a in new_alerts)
        parts.append(f'<div style="margin-bottom:0.75rem;display:flex;flex-wrap:wrap;gap:0.4rem">{badges}</div>')

    # 거시적 흐름
    if causal_chains:
        chain_html = "\n".join(f'<p style="font-size:0.8rem;color:#0c4a6e;margin:0.2rem 0;line-height:1.6">{c}</p>' for c in causal_chains)
        parts.append(
            f'<div style="margin-bottom:1.25rem;padding:0.75rem 1rem;background:#f0f9ff;border-left:3px solid #38bdf8;border-radius:0 6px 6px 0">'
            f'<p style="font-size:0.8rem;font-weight:700;color:#0369a1;margin-bottom:0.4rem">🔗 거시적 흐름</p>'
            f'{chain_html}</div>'
        )

    # 브리핑 본문
    for line in text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        line = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", line)
        if line.startswith(SECTION_STARTERS):
            parts.append(
                f'<h2 style="font-size:1.05rem;font-weight:700;color:#0f172a;'
                f'margin:1.75rem 0 0.5rem;padding-bottom:0.25rem;'
                f'border-bottom:1px solid #e2e8f0">{line}</h2>'
            )
        elif line.startswith("- "):
            parts.append(f'<p style="margin:0.3rem 0 0.3rem 1rem;line-height:1.75">• {line[2:]}</p>')
        else:
            parts.append(f'<p style="margin:0.3rem 0;line-height:1.75">{line}</p>')

    return "\n".join(parts)

# ── Supabase upsert ────────────────────────────────────────────────────────────
def upsert(date, title, content, weather_emoji, weather_label):
    payload = {
        "date": date,
        "title": title,
        "content": content,
        "weather_emoji": weather_emoji,
        "weather_label": weather_label,
    }
    r = httpx.post(
        f"{SUPABASE_URL}/rest/v1/daily_situation?on_conflict=date",
        headers={**HDR_SERVICE, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"},
        json=payload,
        timeout=30
    )
    r.raise_for_status()
    print(f"OK: {date} upserted (status {r.status_code})")

# ── Main ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    target_date = sys.argv[1] if len(sys.argv) > 1 else TODAY
    print(f"Generating daily situation for {target_date} ...")
    briefing_text, weather, causal_chains, new_alerts, stocks = generate_briefing()
    html = to_html(briefing_text, weather["emoji"], weather["label"], weather.get("reason", ""), causal_chains, new_alerts, stocks)
    title = datetime.strptime(target_date, "%Y-%m-%d").strftime("%Y년 %m월 %d일 시황")
    upsert(target_date, title, html, weather["emoji"], weather["label"])
    print("Done.")
