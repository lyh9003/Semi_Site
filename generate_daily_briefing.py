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

KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST).strftime("%Y-%m-%d")
TODAY_LABEL = datetime.now(KST).strftime("%Y년 %m월 %d일")

HDR_ANON    = {"apikey": ANON_KEY,    "Authorization": f"Bearer {ANON_KEY}"}
HDR_SERVICE = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}

# ── 뉴스 폴백 조회 ─────────────────────────────────────────────────────────────
def fetch_news():
    base = f"{SUPABASE_URL}/rest/v1/news?select=title,company,date,summary,keyword"
    # 최신 날짜
    r = httpx.get(f"{SUPABASE_URL}/rest/v1/news?select=date&order=date.desc&limit=1", headers=HDR_ANON)
    rows = r.json()
    if not rows: return []
    d = rows[0]["date"]

    for imp in [3, 2]:
        r2 = httpx.get(f"{base}&importance=eq.{imp}&date=eq.{d}&order=date.desc&limit=10", headers=HDR_ANON)
        data = r2.json()
        if data: return data

    # 전날 importance=3
    r3 = httpx.get(f"{SUPABASE_URL}/rest/v1/news?select=date&date=lt.{d}&order=date.desc&limit=1", headers=HDR_ANON)
    prev = r3.json()
    if not prev: return []
    pd = prev[0]["date"]
    r4 = httpx.get(f"{base}&importance=eq.3&date=eq.{pd}&order=date.desc&limit=10", headers=HDR_ANON)
    return r4.json() if r4.status_code == 200 else []

# ── 브리핑 생성 ────────────────────────────────────────────────────────────────
def generate_briefing():
    news     = fetch_news()
    reports  = httpx.get(f"{SUPABASE_URL}/rest/v1/stock_reports?select=title,securities_firm,date,summary&order=date.desc&limit=5", headers=HDR_ANON).json()
    telegrams = httpx.get(f"{SUPABASE_URL}/rest/v1/telegram_messages?select=channel,summary,date_utc,sentiment&order=date_utc.desc,forward_count.desc&limit=10", headers=HDR_ANON).json()

    ctx = []
    for n in news:
        ctx.append(f"[뉴스] ({n.get('date','')}) {n.get('title','')}{' — ' + n['company'] if n.get('company') else ''}\n{n.get('summary','')}")
    for r in reports:
        ctx.append(f"[리포트] ({r.get('date','')}) {r.get('title','')} — {r.get('securities_firm','')}\n{r.get('summary','')}")
    for t in telegrams:
        ctx.append(f"[텔레그램] ({(t.get('date_utc') or '')[:10]}) {t.get('channel','')} [{t.get('sentiment','중립')}]\n{t.get('summary','')}")

    body = {
        "model": "gpt-4.1",
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": f"""너는 한국 반도체·주식 시황 브리핑 전문가야.
오늘({TODAY_LABEL}) 최신 뉴스·리포트·텔레그램을 분석해서 JSON으로 응답해.

JSON 형식:
{{
  "weather": {{"emoji": "<날씨 이모지>", "label": "<날씨 이름>", "reason": "<한 문장>"}},
  "briefing": "<브리핑 전문>"
}}

날씨 기준 (6개 중 하나):
- {{"emoji":"☀️","label":"맑음"}} — 전반적 강세
- {{"emoji":"🌤️","label":"구름 조금"}} — 긍정적이나 일부 불확실성
- {{"emoji":"⛅","label":"흐림"}} — 혼조세
- {{"emoji":"🌧️","label":"비"}} — 약세
- {{"emoji":"⛈️","label":"폭풍"}} — 급락·리스크 급등
- {{"emoji":"🌫️","label":"안개"}} — 극도의 불확실성

briefing 형식 (마크다운 없이 plain text):
📌 핵심 요약 (4~5문장)
내용...

📈 주목 이슈
- 이슈 1: 내용 (2~3문장)
- 이슈 2: 내용
...

🔍 주목 키워드
키워드1, 키워드2, ...

💡 시사점
내용 (2~3문장)"""},
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
    return raw.get("briefing", ""), raw.get("weather", {"emoji": "⛅", "label": "흐림", "reason": ""})

# ── 텍스트 → HTML 변환 ─────────────────────────────────────────────────────────
SECTION_STARTERS = ("📌", "📈", "🔍", "💡")

def to_html(text: str, weather_emoji: str, weather_label: str, weather_reason: str) -> str:
    parts = [
        f'<p style="font-size:1rem;font-weight:700;margin-bottom:1.5rem">'
        f'{weather_emoji} 오늘의 시황 날씨: <strong>{weather_label}</strong>'
        f'{" — " + weather_reason if weather_reason else ""}</p>'
    ]
    for line in text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        # 볼드
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
def upsert(date: str, title: str, content: str, weather_emoji: str, weather_label: str):
    payload = {
        "date": date,
        "title": title,
        "content": content,
        "weather_emoji": weather_emoji,
        "weather_label": weather_label,
    }
    r = httpx.post(
        f"{SUPABASE_URL}/rest/v1/daily_situation",
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
    briefing_text, weather = generate_briefing()
    html = to_html(briefing_text, weather["emoji"], weather["label"], weather.get("reason", ""))
    title = datetime.strptime(target_date, "%Y-%m-%d").strftime("%Y년 %m월 %d일 시황")
    upsert(target_date, title, html, weather["emoji"], weather["label"])
    print("Done.")
