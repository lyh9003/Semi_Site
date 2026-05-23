"""
임베딩 생성 스크립트 (Phase 2)
OpenAI text-embedding-3-small 모델로 뉴스·리포트·텔레그램 임베딩 → Supabase 저장
임베딩 없는 항목만 처리하므로 중단 후 재실행 안전.
"""

import os, sys, json, time
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

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SERVICE_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ANON_KEY     = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
OPENAI_KEY   = os.getenv("OPENAI_API_KEY", "")
EMBED_MODEL  = "text-embedding-3-small"
WRITE_KEY    = SERVICE_KEY or ANON_KEY
BASE         = SUPABASE_URL.rstrip("/") + "/rest/v1"

if not SUPABASE_URL or not WRITE_KEY:
    print("❌ Supabase 설정 없음"); sys.exit(1)
if not OPENAI_KEY:
    print("❌ OPENAI_API_KEY 없음"); sys.exit(1)

READ_HDR = {"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}"}
WRITE_HDR = {
    "apikey": WRITE_KEY, "Authorization": f"Bearer {WRITE_KEY}",
    "Content-Type": "application/json", "Prefer": "return=minimal",
}
OPENAI_HDR = {
    "Authorization": f"Bearer {OPENAI_KEY}",
    "Content-Type": "application/json",
}

TABLES = [
    {
        "name": "news",
        "select": "id,title,summary",
        "text_fn": lambda r: f"{r.get('title','')} {r.get('summary','')}".strip(),
    },
    {
        "name": "stock_reports",
        "select": "id,title,one_line_summary,summary",
        "text_fn": lambda r: " ".join(filter(None, [
            r.get("title",""), r.get("one_line_summary",""), r.get("summary",""),
        ])).strip(),
    },
    {
        "name": "telegram_messages",
        "select": "id,summary,message",
        "text_fn": lambda r: (r.get("summary") or r.get("message") or "")[:800].strip(),
    },
]


def get_embeddings_batch(texts: list[str]) -> list[list[float] | None]:
    """OpenAI Embeddings API 배치 호출 (최대 100개)"""
    try:
        r = httpx.post(
            "https://api.openai.com/v1/embeddings",
            headers=OPENAI_HDR,
            json={"model": EMBED_MODEL, "input": texts},
            timeout=60,
        )
        if r.status_code == 200:
            data = r.json()["data"]
            data.sort(key=lambda x: x["index"])
            return [d["embedding"] for d in data]
        print(f"  [OpenAI 오류] {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"  [OpenAI 연결 오류] {e}")
    return [None] * len(texts)


def process_table(cfg: dict):
    table = cfg["name"]
    print(f"\n{'─'*40}\n[{table}] 처리 시작")

    try:
        r = httpx.get(f"{BASE}/{table}", headers=READ_HDR, params={
            "select": cfg["select"], "embedding": "is.null", "limit": "2000",
        }, timeout=20)
        r.raise_for_status()
    except Exception as e:
        print(f"  조회 실패: {e}"); return

    items = r.json()
    print(f"  임베딩 필요: {len(items)}건")
    if not items:
        print("  ✅ 모두 처리됨"); return

    # 텍스트 준비
    texts = [cfg["text_fn"](item) for item in items]

    BATCH = 50
    success = skip = 0

    for b_start in range(0, len(items), BATCH):
        batch_items = items[b_start:b_start + BATCH]
        batch_texts = texts[b_start:b_start + BATCH]

        valid_indices = [i for i, t in enumerate(batch_texts) if t and len(t) >= 5]
        if not valid_indices:
            skip += len(batch_items); continue

        valid_texts = [batch_texts[i] for i in valid_indices]
        embeddings = get_embeddings_batch(valid_texts)

        for j, idx in enumerate(valid_indices):
            item = batch_items[idx]
            emb  = embeddings[j]
            if not emb:
                skip += 1; continue
            try:
                up = httpx.patch(
                    f"{BASE}/{table}?id=eq.{item['id']}",
                    headers=WRITE_HDR,
                    content=json.dumps({"embedding": emb}),
                    timeout=15,
                )
                if up.status_code in (200, 204):
                    success += 1
                else:
                    print(f"  저장 실패 ID {item['id']}: {up.status_code}")
                    skip += 1
            except Exception as e:
                print(f"  저장 오류 ID {item['id']}: {e}"); skip += 1

        end = min(b_start + BATCH, len(items))
        print(f"  [{end}/{len(items)}] 배치 완료")
        time.sleep(0.3)

    print(f"  ✅ 성공:{success} / 건너뜀:{skip} / 전체:{len(items)}")


if __name__ == "__main__":
    print(f"임베딩 모델 : {EMBED_MODEL}")
    print(f"Supabase    : {SUPABASE_URL}")

    # OpenAI 연결 확인
    try:
        r = httpx.get("https://api.openai.com/v1/models", headers=OPENAI_HDR, timeout=10)
        if r.status_code != 200:
            print(f"❌ OpenAI 인증 실패: {r.status_code}"); sys.exit(1)
        print("OpenAI      : 연결 OK")
    except Exception as e:
        print(f"❌ OpenAI 연결 실패: {e}"); sys.exit(1)

    for cfg in TABLES:
        process_table(cfg)

    print(f"\n{'='*40}\n✅ 임베딩 생성 완료")
