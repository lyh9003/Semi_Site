"""
Phase 3 — 지식 그래프 구축 스크립트
1. 최근 6개월 문서에서 키워드 수집
2. 유니크 키워드를 gpt-4o-mini로 엔티티 분류 (company/metric/event/product/sector/other)
3. entities, entity_mentions, entity_relations 테이블에 저장
"""

import os, sys, json, time, re
from datetime import datetime, timedelta
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
WRITE_KEY    = SERVICE_KEY or ANON_KEY
BASE         = SUPABASE_URL.rstrip("/") + "/rest/v1"

if not SUPABASE_URL or not WRITE_KEY:
    print("❌ Supabase 설정 없음"); sys.exit(1)
if not OPENAI_KEY:
    print("❌ OPENAI_API_KEY 없음"); sys.exit(1)

READ_HDR = {"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}"}
WRITE_HDR = {
    "apikey": WRITE_KEY, "Authorization": f"Bearer {WRITE_KEY}",
    "Content-Type": "application/json", "Prefer": "return=representation",
}
OPENAI_HDR = {
    "Authorization": f"Bearer {OPENAI_KEY}",
    "Content-Type": "application/json",
}

SIX_MONTHS_AGO = (datetime.now() - timedelta(days=180)).strftime("%Y-%m-%d")


# ─── 1단계: 키워드 수집 ────────────────────────────────────────────────────────

def parse_keywords(kw: str) -> list[str]:
    if not kw:
        return []
    tokens = re.split(r"[,，\s#·|]+", kw)
    return [t.strip().lower() for t in tokens if len(t.strip()) > 1]


def fetch_keywords() -> dict[str, list[tuple[int, list[str]]]]:
    """소스별로 (source_id, keywords) 리스트 반환"""
    sources: dict[str, list[tuple[int, list[str]]]] = {
        "news": [], "report": [], "telegram": []
    }

    # 뉴스
    print("  [뉴스] 키워드 수집 중...")
    cursor = None
    while True:
        params = {
            "select": "id,keyword",
            "date": f"gte.{SIX_MONTHS_AGO}",
            "order": "id.desc",
            "limit": "1000",
        }
        if cursor:
            params["id"] = f"lt.{cursor}"
        r = httpx.get(f"{BASE}/news", headers=READ_HDR, params=params, timeout=30)
        rows = r.json()
        if not rows:
            break
        for row in rows:
            kws = parse_keywords(row.get("keyword", ""))
            if kws:
                sources["news"].append((row["id"], kws))
        if len(rows) < 1000:
            break
        cursor = rows[-1]["id"]
    print(f"    → {len(sources['news'])}건")

    # 증권리포트
    print("  [증권리포트] 키워드 수집 중...")
    r = httpx.get(f"{BASE}/stock_reports", headers=READ_HDR, params={
        "select": "id,keyword",
        "date": f"gte.{SIX_MONTHS_AGO}",
        "limit": "1000",
    }, timeout=30)
    for row in r.json():
        kws = parse_keywords(row.get("keyword", ""))
        if kws:
            sources["report"].append((row["id"], kws))
    print(f"    → {len(sources['report'])}건")

    # 텔레그램
    print("  [텔레그램] 키워드 수집 중...")
    cursor = None
    while True:
        params = {
            "select": "id,keywords",
            "date_utc": f"gte.{SIX_MONTHS_AGO}",
            "order": "id.desc",
            "limit": "1000",
        }
        if cursor:
            params["id"] = f"lt.{cursor}"
        r = httpx.get(f"{BASE}/telegram_messages", headers=READ_HDR, params=params, timeout=30)
        rows = r.json()
        if not rows:
            break
        for row in rows:
            kws = parse_keywords(row.get("keywords", ""))
            if kws:
                sources["telegram"].append((row["id"], kws))
        if len(rows) < 1000:
            break
        cursor = rows[-1]["id"]
    print(f"    → {len(sources['telegram'])}건")

    return sources


# ─── 2단계: 유니크 키워드 → gpt-4o-mini 엔티티 분류 ─────────────────────────

CLASSIFY_SYSTEM = """너는 한국 반도체·주식 전문가야.
주어진 키워드 목록에서 각 키워드를 아래 타입 중 하나로 분류해.
- company: 기업명 (삼성전자, SK하이닉스, TSMC, 엔비디아 등)
- product: 제품·기술 (HBM, DDR5, NAND, CoWoS 등)
- metric: 지표·수치 (목표주가, 영업이익, 매출, PER 등)
- event: 이벤트·상황 (실적발표, M&A, 증설, 감산 등)
- sector: 산업·섹터 (반도체, 메모리, 파운드리, AI 등)
- other: 위에 해당 없음

JSON 배열로만 응답해. 예:
[{"name":"삼성전자","type":"company"},{"name":"HBM","type":"product"}]"""


def classify_entities(keywords: list[str]) -> dict[str, str]:
    """유니크 키워드 → {name: type} 매핑 반환"""
    result: dict[str, str] = {}
    CHUNK = 80  # 한 번에 분류할 키워드 수

    for i in range(0, len(keywords), CHUNK):
        chunk = keywords[i:i + CHUNK]
        kw_list = "\n".join(chunk)
        try:
            r = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers=OPENAI_HDR,
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": CLASSIFY_SYSTEM},
                        {"role": "user", "content": kw_list},
                    ],
                    "temperature": 0,
                    "max_tokens": 2000,
                },
                timeout=30,
            )
            if r.status_code == 200:
                text = r.json()["choices"][0]["message"]["content"].strip()
                # JSON 배열 파싱
                text = re.sub(r"^```json\s*|```$", "", text, flags=re.MULTILINE).strip()
                items = json.loads(text)
                for item in items:
                    name = item.get("name", "").strip().lower()
                    typ  = item.get("type", "other")
                    if name:
                        result[name] = typ
            else:
                print(f"  [분류 오류] {r.status_code}")
        except Exception as e:
            print(f"  [분류 예외] {e}")

        print(f"  분류 진행: {min(i+CHUNK, len(keywords))}/{len(keywords)}")
        time.sleep(0.3)

    return result


# ─── 3단계: Supabase 저장 ─────────────────────────────────────────────────────

def load_entities_from_db() -> dict[str, int]:
    """DB에서 기존 entities 전체 로드 → {name: id}"""
    name_to_id: dict[str, int] = {}
    cursor = None
    while True:
        params: dict = {"select": "id,name", "order": "id.asc", "limit": "1000"}
        if cursor:
            params["id"] = f"gt.{cursor}"
        r = httpx.get(f"{BASE}/entities", headers=READ_HDR, params=params, timeout=30)
        rows = r.json()
        if not rows:
            break
        for row in rows:
            name_to_id[row["name"]] = row["id"]
        if len(rows) < 1000:
            break
        cursor = rows[-1]["id"]
    return name_to_id


def insert_new_entities(entity_map: dict[str, str], existing: dict[str, int]) -> dict[str, int]:
    """entity_map 중 DB에 없는 것만 INSERT → 전체 name_to_id 반환"""
    new_rows = [
        {"name": name, "type": typ}
        for name, typ in entity_map.items()
        if name not in existing
    ]
    name_to_id = dict(existing)
    if not new_rows:
        return name_to_id

    CHUNK = 200
    for i in range(0, len(new_rows), CHUNK):
        chunk = new_rows[i:i + CHUNK]
        r = httpx.post(
            f"{BASE}/entities",
            headers={**WRITE_HDR, "Prefer": "return=representation"},
            content=json.dumps(chunk),
            timeout=30,
        )
        if r.status_code in (200, 201):
            for row in r.json():
                name_to_id[row["name"]] = row["id"]
        else:
            print(f"  [entities 저장 오류] {r.status_code}: {r.text[:200]}")

    return name_to_id


def save_mentions(sources: dict[str, list[tuple[int, list[str]]]], name_to_id: dict[str, int]):
    """entity_mentions 테이블 저장"""
    seen: set[tuple] = set()
    rows = []
    for source_type, items in sources.items():
        for source_id, kws in items:
            for kw in kws:
                eid = name_to_id.get(kw)
                if eid:
                    key = (eid, source_type, source_id)
                    if key not in seen:
                        seen.add(key)
                        rows.append({"entity_id": eid, "source_type": source_type, "source_id": source_id})

    print(f"  mention 총 {len(rows)}건 저장 중 (중복 제거 후)...")
    CHUNK = 500
    saved = 0
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        r = httpx.post(
            f"{BASE}/entity_mentions",
            headers={**WRITE_HDR, "Prefer": "resolution=ignore-duplicates,return=minimal"},
            content=json.dumps(chunk),
            timeout=30,
        )
        if r.status_code in (200, 201):
            saved += len(chunk)
        else:
            print(f"  [mention 저장 오류] {r.status_code}: {r.text[:100]}")
        time.sleep(0.1)

    print(f"  ✅ mention 저장 완료: {saved}건")


def update_mention_counts(name_to_id: dict[str, int]):
    """entities.mention_count를 실제 mention 수로 갱신"""
    from collections import Counter
    counts: Counter = Counter()
    cursor = None
    while True:
        params: dict = {"select": "id,entity_id", "order": "id.asc", "limit": "1000"}
        if cursor:
            params["id"] = f"gt.{cursor}"
        r = httpx.get(f"{BASE}/entity_mentions", headers=READ_HDR, params=params, timeout=30)
        rows = r.json()
        if not rows:
            break
        for row in rows:
            counts[row["entity_id"]] += 1
        if len(rows) < 1000:
            break
        cursor = rows[-1].get("id")  # entity_mentions has id column

    updated = 0
    for eid, cnt in counts.items():
        r = httpx.patch(
            f"{BASE}/entities?id=eq.{eid}",
            headers={**WRITE_HDR, "Prefer": "return=minimal"},
            content=json.dumps({"mention_count": cnt}),
            timeout=10,
        )
        if r.status_code in (200, 204):
            updated += 1
    print(f"  ✅ mention_count 업데이트: {updated}개 엔티티")


def save_relations(sources: dict[str, list[tuple[int, list[str]]]], name_to_id: dict[str, int]):
    """같은 문서 내 공동 출현 엔티티 쌍 → entity_relations"""
    from collections import defaultdict
    pair_weight: dict[tuple[int,int], float] = defaultdict(float)

    for source_type, items in sources.items():
        for _, kws in items:
            eids = list({name_to_id[k] for k in kws if k in name_to_id})
            if len(eids) < 2:
                continue
            for a in range(len(eids)):
                for b in range(a + 1, len(eids)):
                    lo, hi = min(eids[a], eids[b]), max(eids[a], eids[b])
                    pair_weight[(lo, hi)] += 1.0

    rows = [
        {"from_entity_id": lo, "to_entity_id": hi, "weight": w}
        for (lo, hi), w in pair_weight.items()
        if w >= 2  # 2번 이상 공동 출현한 쌍만
    ]
    print(f"  relation 총 {len(rows)}건 저장 중 (공동출현 2회 이상)...")

    CHUNK = 500
    saved = 0
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        r = httpx.post(
            f"{BASE}/entity_relations",
            headers={**WRITE_HDR, "Prefer": "resolution=merge-duplicates,return=minimal"},
            content=json.dumps(chunk),
            timeout=30,
        )
        if r.status_code in (200, 201):
            saved += len(chunk)
        else:
            print(f"  [relation 저장 오류] {r.status_code}: {r.text[:100]}")
        time.sleep(0.1)

    print(f"  ✅ relation 저장 완료: {saved}건")


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 50)
    print("Phase 3 — 지식 그래프 구축")
    print(f"기준: {SIX_MONTHS_AGO} 이후 데이터")
    print("=" * 50)

    # 1. 키워드 수집
    print("\n[1/4] 키워드 수집")
    sources = fetch_keywords()
    total_docs = sum(len(v) for v in sources.values())
    print(f"  총 {total_docs}건 문서에서 키워드 수집 완료")

    # 유니크 키워드 추출
    all_kws: set[str] = set()
    for items in sources.values():
        for _, kws in items:
            all_kws.update(kws)
    unique_kws = sorted(all_kws)
    print(f"  유니크 키워드: {len(unique_kws)}개")

    # 2. 기존 entities 로드 (있으면 스킵, 없으면 분류 후 삽입)
    print(f"\n[2/4] entities 로드")
    existing = load_entities_from_db()
    print(f"  DB 기존 엔티티: {len(existing)}개")

    if len(existing) < 100:
        print(f"  → gpt-4o-mini 분류 실행 ({len(unique_kws)}개)")
        entity_map = classify_entities(unique_kws)
        entity_map = {k: v for k, v in entity_map.items() if v != "other"}
        print(f"  분류 결과: {len(entity_map)}개 엔티티")
    else:
        print(f"  → 기존 분류 재사용 (API 호출 생략)")
        entity_map = {}  # 새 항목만 삽입

    # 3. 신규 entities 삽입
    print(f"\n[3/4] entities 저장")
    name_to_id = insert_new_entities(entity_map, existing)
    print(f"  ✅ 총 {len(name_to_id)}개 엔티티 사용 가능")

    # 4. mentions + relations 저장
    print(f"\n[4/4] mentions + relations 저장")
    save_mentions(sources, name_to_id)
    save_relations(sources, name_to_id)

    # 5. entities.mention_count 업데이트
    print(f"\n[5/5] mention_count 업데이트")
    update_mention_counts(name_to_id)

    print(f"\n{'='*50}")
    print("✅ Phase 3 지식 그래프 구축 완료")
