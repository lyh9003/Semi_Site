"""
하이브리드 주간 요약:
- 날씨 흐름·날짜 구조 → daily_situation
- 실제 분석 콘텐츠   → 원본 뉴스·리포트·텔레그램 raw 데이터
daily-briefing.yml에서 KST 23:30에 자동 실행
"""

import os, re, json
from datetime import datetime, timezone, timedelta
import httpx

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SERVICE_KEY  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ANON_KEY     = os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
OPENAI_KEY   = os.environ["OPENAI_API_KEY"]

KST = timezone(timedelta(hours=9))
NOW_KST   = datetime.now(KST)
DATE_TO   = NOW_KST.strftime("%Y-%m-%d")
DATE_FROM = (NOW_KST - timedelta(days=6)).strftime("%Y-%m-%d")

HDR_ANON    = {"apikey": ANON_KEY,    "Authorization": f"Bearer {ANON_KEY}"}
HDR_SERVICE = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}

SECTION_STARTERS = ("📊", "📈", "🏭", "🌐", "⚠️", "💡")


# ── HTML 변환 ──────────────────────────────────────────────────────────────────
def to_html(text, weather_trend, weather_summary, date_from, date_to):
    parts = [
        f'<div style="margin-bottom:1.25rem;padding:0.75rem 1rem;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">',
        f'<p style="font-size:0.8rem;color:#64748b;margin-bottom:0.25rem">📅 {date_from} ~ {date_to} · 주간 반도체 시황 종합 리포트</p>',
        f'<p style="font-size:1rem;font-weight:700;color:#0f172a">{weather_trend}</p>',
        f'<p style="font-size:0.85rem;color:#475569;margin-top:0.2rem">{weather_summary}</p>',
        '</div>',
    ]
    for line in text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        line = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", line)
        if line.startswith(SECTION_STARTERS):
            parts.append(
                f'<h2 style="font-size:1.1rem;font-weight:700;color:#0f172a;'
                f'margin:2rem 0 0.6rem;padding-bottom:0.3rem;'
                f'border-bottom:2px solid #e2e8f0">{line}</h2>'
            )
        elif line.startswith("- "):
            parts.append(f'<p style="margin:0.35rem 0 0.35rem 1.2rem;line-height:1.85">• {line[2:]}</p>')
        else:
            parts.append(f'<p style="margin:0.4rem 0;line-height:1.9;color:#1e293b">{line}</p>')
    return "\n".join(parts)


# ── 데이터 수집 ────────────────────────────────────────────────────────────────
def fetch_daily_weather():
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/daily_situation"
        f"?select=date,weather_emoji,weather_label"
        f"&date=gte.{DATE_FROM}&date=lte.{DATE_TO}&order=date.asc",
        headers=HDR_ANON, timeout=30
    )
    return r.json() if r.status_code == 200 else []


def fetch_news():
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/news"
        f"?select=title,company,date,summary,importance"
        f"&date=gte.{DATE_FROM}&date=lte.{DATE_TO}"
        f"&importance=gte.2&order=date.desc,importance.desc&limit=50",
        headers=HDR_ANON, timeout=30
    )
    return r.json() if r.status_code == 200 else []


def fetch_reports():
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/stock_reports"
        f"?select=title,securities_firm,date,summary"
        f"&date=gte.{DATE_FROM}&date=lte.{DATE_TO}"
        f"&order=date.desc&limit=20",
        headers=HDR_ANON, timeout=30
    )
    return r.json() if r.status_code == 200 else []


def fetch_telegrams():
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/telegram_messages"
        f"?select=channel,summary,date_utc,sentiment,forward_count"
        f"&date_utc=gte.{DATE_FROM}T00:00:00"
        f"&order=forward_count.desc,date_utc.desc&limit=40",
        headers=HDR_ANON, timeout=30
    )
    return r.json() if r.status_code == 200 else []


# ── 브리핑 생성 ────────────────────────────────────────────────────────────────
def generate():
    daily_weather = fetch_daily_weather()
    news          = fetch_news()
    reports       = fetch_reports()
    telegrams     = fetch_telegrams()

    if not news and not telegrams:
        print("원본 데이터 없음 — 스킵")
        return

    # 날씨 흐름 (daily_situation 기반, 분석 내용은 raw 데이터 사용)
    if daily_weather:
        weather_flow = " → ".join(
            f"{r['date'][5:]}({r['weather_emoji']}{r['weather_label']})"
            for r in daily_weather
        )
    else:
        weather_flow = f"{DATE_FROM} ~ {DATE_TO}"

    # 컨텍스트 구성
    ctx_parts = []

    if daily_weather:
        ctx_parts.append("[이번 주 일별 날씨 흐름]\n" + "\n".join(
            f"{r['date']} {r['weather_emoji']} {r['weather_label']}"
            for r in daily_weather
        ))

    if telegrams:
        lines = ["[텔레그램 주요 메시지 — 업계 반응 (공유수 높은 순)]"]
        for t in telegrams:
            d = (t.get("date_utc") or "")[:10]
            lines.append(
                f"({d}) [{t.get('channel','')}] [{t.get('sentiment','중립')}] {t.get('summary','')}"
            )
        ctx_parts.append("\n".join(lines))

    if reports:
        lines = ["[증권사 리포트]"]
        for r in reports:
            lines.append(
                f"({r.get('date','')}) {r.get('title','')} — {r.get('securities_firm','')}\n"
                f"  {r.get('summary','')}"
            )
        ctx_parts.append("\n".join(lines))

    if news:
        lines = ["[뉴스 — 중요도·날짜순]"]
        for n in news:
            co = f" — {n['company']}" if n.get("company") else ""
            lines.append(
                f"({n.get('date','')}) [중요도{n.get('importance','')}] {n.get('title','')}{co}\n"
                f"  {n.get('summary','')}"
            )
        ctx_parts.append("\n".join(lines))

    ctx = "\n\n".join(ctx_parts)

    system_prompt = f"""너는 한국 반도체 시황 전문 주간 리포트 작성자야.
{DATE_FROM} ~ {DATE_TO} 원본 데이터(뉴스·증권사 리포트·텔레그램)를 바탕으로 깊이 있는 주간 종합 리포트를 작성해.
일별 브리핑보다 훨씬 상세하고 길어야 하며, 구체적 기업명·수치·날짜를 적극 활용해.

JSON 형식:
{{
  "weather_trend": "날짜별 날씨 이모지 흐름 (예: 07/06(⛅흐림) → 07/07(🌧️비) → 07/08(🌤️구름조금))",
  "weather_summary": "주간 날씨 트렌드 한 줄 해석",
  "summary": "주간 리포트 전문 (아래 형식 준수, 전체 2500자 이상)"
}}

summary 형식 (각 섹션 충분히 서술):

📊 **주간 종합 평가**
(5~7문장. 이번 주 반도체 시장 전체를 관통하는 핵심 메시지, 시장 온도, 전주 대비 변화)

📈 **이번 주 Top 5 이슈**
(각 이슈마다 소제목 + 3~5문장. 구체적 날짜·기업·수치 포함. 초반→후반 전개 과정 서술)

🏭 **섹터별 동향**
(HBM, DRAM, NAND, 파운드리, 시스템반도체 각각 2~3문장. 공급·수요·가격 현황 포함)

🌐 **지정학·매크로 영향**
(미중 무역·관세, 환율, 글로벌 수요·재고 사이클 3~5문장)

⚠️ **리스크 요인 종합**
(이번 주 부각·지속된 리스크 3~4가지. 각 2문장씩. 하방 리스크 중심)

💡 **다음 주 핵심 체크포인트**
(구체적 일정·이벤트·실적 발표·정책 일정 포함. 3~4가지)

리스크 민감도 원칙: 부정적 신호(수요 둔화·재고·가격 하락·지정학 리스크)는 낙관론보다 무게있게 다뤄."""

    body = {
        "model": "gpt-4.1",
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": f"{DATE_FROM} ~ {DATE_TO} 원본 데이터:\n\n{ctx}"}
        ],
        "max_tokens": 3500,
        "temperature": 0.3,
    }

    r2 = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"},
        json=body, timeout=120
    )
    r2.raise_for_status()
    raw = json.loads(r2.json()["choices"][0]["message"]["content"])

    html = to_html(
        raw.get("summary", ""),
        raw.get("weather_trend", weather_flow),
        raw.get("weather_summary", ""),
        DATE_FROM, DATE_TO
    )

    r3 = httpx.post(
        f"{SUPABASE_URL}/rest/v1/weekly_summary",
        headers={**HDR_SERVICE, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json={"date_from": DATE_FROM, "date_to": DATE_TO, "content": html},
        timeout=30
    )
    r3.raise_for_status()
    print(f"OK: weekly_summary {DATE_FROM}~{DATE_TO} saved (status {r3.status_code})")


if __name__ == "__main__":
    generate()
