"""
최근 7일 일별 시황 → gpt-4.1 주간 요약 → weekly_summary 테이블 upsert
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
NOW_KST  = datetime.now(KST)
DATE_TO   = NOW_KST.strftime("%Y-%m-%d")
DATE_FROM = (NOW_KST - timedelta(days=6)).strftime("%Y-%m-%d")

HDR_ANON    = {"apikey": ANON_KEY,    "Authorization": f"Bearer {ANON_KEY}"}
HDR_SERVICE = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}

SECTION_STARTERS = ("📌", "📈", "⚠️", "💡")

# ── HTML 변환 ──────────────────────────────────────────────────────────────────
def to_html(text, weather_trend, weather_summary, date_from, date_to):
    parts = [
        f'<div style="margin-bottom:1rem;padding:0.75rem 1rem;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">',
        f'<p style="font-size:0.8rem;color:#64748b;margin-bottom:0.3rem">📅 {date_from} ~ {date_to} 주간 반도체 시황</p>',
        f'<p style="font-size:0.9rem;font-weight:600;color:#0f172a">{weather_trend} {weather_summary}</p>',
        f'</div>',
    ]
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

# ── HTML → 텍스트 ──────────────────────────────────────────────────────────────
def strip_html(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()

# ── 생성 ──────────────────────────────────────────────────────────────────────
def generate():
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/daily_situation"
        f"?select=date,weather_emoji,weather_label,content"
        f"&date=gte.{DATE_FROM}&date=lte.{DATE_TO}&order=date.asc",
        headers=HDR_ANON, timeout=30
    )
    rows = r.json()
    if not rows:
        print("daily_situation 데이터 없음 — 스킵")
        return

    weather_flow = "→".join(row["weather_emoji"] for row in rows)
    ctx = "\n\n".join(
        f"[{row['date']} {row['weather_emoji']}{row['weather_label']}]\n{strip_html(row['content'])[:800]}"
        for row in rows
    )

    body = {
        "model": "gpt-4.1",
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": f"""너는 한국 반도체 시황 주간 분석가야. 최근 7일간의 일별 시황 브리핑을 종합해서 주간 요약을 작성해.

JSON 형식:
{{
  "weather_trend": "날씨 이모지 흐름 (예: ⛅→🌧️→🌤️→☀️, rows에서 가져올것)",
  "weather_summary": "날씨 트렌드 한 줄 요약 (예: '초반 불확실 후 후반 회복세')",
  "summary": "주간 시황 전문"
}}

summary 형식:
📌 **이번 주 핵심 메시지** (3~4문장, 한 주를 관통하는 메인 메시지)
📈 **주요 이슈 흐름** (3가지, 각 2~3문장, 초반→후반 변화 포함)
⚠️ **지속 리스크** (2~3가지 불릿, 해소되지 않은 리스크)
💡 **다음 주 주목 포인트** (2~3가지 불릿)

리스크 민감도 원칙: 부정적 신호를 낙관적 신호보다 무게있게 다뤄. 시사점에는 하방 리스크를 반드시 포함."""},
            {"role": "user", "content": f"{DATE_FROM} ~ {DATE_TO} 7일 시황:\n\n{ctx}"}
        ],
        "max_tokens": 1200,
        "temperature": 0.3,
    }

    r2 = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"},
        json=body, timeout=60
    )
    r2.raise_for_status()
    raw = json.loads(r2.json()["choices"][0]["message"]["content"])

    html = to_html(
        raw.get("summary", ""),
        raw.get("weather_trend", weather_flow),
        raw.get("weather_summary", ""),
        DATE_FROM, DATE_TO
    )

    # 저장
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
