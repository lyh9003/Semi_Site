"""
임베딩 생성 스크립트 (Phase 2)

Ollama nomic-embed-text 모델로 뉴스·리포트·텔레그램 텍스트를 임베딩해 Supabase에 저장.
임베딩이 없는 항목만 처리하므로 중단 후 재실행해도 안전.

사전 조건:
  1. Supabase SQL Editor에서 003_add_embeddings.sql 실행
  2. Ollama에 nomic-embed-text 설치: ollama pull nomic-embed-text
  3. .env.local에 SUPABASE_SERVICE_ROLE_KEY 추가 (쓰기 권한 필요)

실행:
  python generate_embeddings.py
"""

import os
import sys
import json
import time
import httpx

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


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

SUPABASE_URL  = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SERVICE_KEY   = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ANON_KEY      = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
OLLAMA_URL    = os.getenv("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL   = os.getenv("EMBED_MODEL", "nomic-embed-text")

# 쓰기는 service role key 필요 (없으면 anon key로 시도)
WRITE_KEY = SERVICE_KEY or ANON_KEY

if not SUPABASE_URL or not WRITE_KEY:
    print("❌ SUPABASE_URL 또는 키가 없습니다. .env.local을 확인하세요.")
    sys.exit(1)

if not SERVICE_KEY:
    print("⚠️  SUPABASE_SERVICE_ROLE_KEY 없음 — anon key로 시도합니다 (RLS 오류 날 수 있음)")

BASE = SUPABASE_URL.rstrip("/") + "/rest/v1"

READ_HEADERS = {
    "apikey": ANON_KEY,
    "Authorization": f"Bearer {ANON_KEY}",
}
WRITE_HEADERS = {
    "apikey": WRITE_KEY,
    "Authorization": f"Bearer {WRITE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

# ── 테이블 설정 ───────────────────────────────────────────────
TABLES = [
    {
        "name": "news",
        "select": "id,title,summary",
        "text_fn": lambda r: f"{r.get('title', '')} {r.get('summary', '')}".strip(),
    },
    {
        "name": "stock_reports",
        "select": "id,title,one_line_summary,summary",
        "text_fn": lambda r: " ".join(filter(None, [
            r.get("title", ""),
            r.get("one_line_summary", ""),
            r.get("summary", ""),
        ])).strip(),
    },
    {
        "name": "telegram_messages",
        "select": "id,summary,message",
        "text_fn": lambda r: (r.get("summary") or r.get("message") or "")[:800].strip(),
    },
]


def get_embedding(text: str) -> list[float] | None:
    """Ollama로 텍스트 임베딩 생성"""
    if not text or len(text) < 5:
        return None
    try:
        r = httpx.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text[:2000]},
            timeout=30,
        )
        if r.status_code == 200:
            return r.json().get("embedding")
        print(f"  [Ollama 오류] {r.status_code}: {r.text[:100]}")
    except Exception as e:
        print(f"  [Ollama 연결 오류] {e}")
    return None


def process_table(cfg: dict):
    table = cfg["name"]
    print(f"\n{'─'*40}")
    print(f"[{table}] 처리 시작")

    # 임베딩 없는 항목 조회
    try:
        r = httpx.get(
            f"{BASE}/{table}",
            headers=READ_HEADERS,
            params={
                "select": cfg["select"],
                "embedding": "is.null",
                "limit": "500",
            },
            timeout=20,
        )
        r.raise_for_status()
    except Exception as e:
        print(f"  조회 실패: {e}")
        return

    items = r.json()
    print(f"  임베딩 필요: {len(items)}건")

    if not items:
        print("  ✅ 모두 처리됨")
        return

    success = 0
    skip = 0
    for i, item in enumerate(items, 1):
        text = cfg["text_fn"](item)
        if not text:
            skip += 1
            continue

        embedding = get_embedding(text)
        if not embedding:
            skip += 1
            print(f"  [{i}/{len(items)}] ID {item['id']} — 임베딩 실패, 건너뜀")
            continue

        # Supabase PATCH
        try:
            up = httpx.patch(
                f"{BASE}/{table}?id=eq.{item['id']}",
                headers=WRITE_HEADERS,
                content=json.dumps({"embedding": embedding}),
                timeout=15,
            )
            if up.status_code in (200, 204):
                success += 1
                print(f"  [{i}/{len(items)}] ID {item['id']} ✓")
            else:
                print(f"  [{i}/{len(items)}] ID {item['id']} 저장 실패 {up.status_code}: {up.text[:80]}")
        except Exception as e:
            print(f"  [{i}/{len(items)}] ID {item['id']} 저장 오류: {e}")

        time.sleep(0.05)

    print(f"  완료 — 성공:{success} / 건너뜀:{skip} / 전체:{len(items)}")


if __name__ == "__main__":
    print(f"임베딩 모델 : {EMBED_MODEL}")
    print(f"Ollama URL  : {OLLAMA_URL}")
    print(f"Supabase    : {SUPABASE_URL}")

    # Ollama 연결 확인
    try:
        r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        models = [m["name"] for m in r.json().get("models", [])]
        if not any(EMBED_MODEL in m for m in models):
            print(f"\n⚠️  {EMBED_MODEL} 모델이 없습니다.")
            print(f"   설치: ollama pull {EMBED_MODEL}")
            sys.exit(1)
        print(f"Ollama 모델 : {', '.join(models)}")
    except Exception as e:
        print(f"\n❌ Ollama 연결 실패: {e}")
        print("   Ollama가 실행 중인지 확인하세요.")
        sys.exit(1)

    for cfg in TABLES:
        process_table(cfg)

    print(f"\n{'='*40}")
    print("✅ 임베딩 생성 완료")
