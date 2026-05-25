"""
entity_relations 에 relation_type / relation_desc 채우기
대상: weight >= 3, relation_type IS NULL (5,703건)
모델: gpt-4.1-mini  배치: 20쌍씩
예상 비용: ~$0.34 / 시간: ~8분
"""
import os, json, time, math, requests
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(".env.local")

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
OPENAI_KEY   = os.environ["OPENAI_API_KEY"]

HDR = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

client = OpenAI(api_key=OPENAI_KEY)

RELATION_TYPES = ["수혜", "공급망", "경쟁", "수요연동", "리스크", "양방향", "포함관계", "무관계"]

SYSTEM = """너는 반도체·주식 시황 전문가야.
두 엔티티의 관계를 분석해서 JSON으로 반환해.

관계 유형:
- 수혜: from이 성장하면 to도 이득 (예: AI수요→HBM수혜)
- 공급망: from→to 방향으로 부품·소재·장비 공급
- 경쟁: 같은 시장에서 점유율 경쟁
- 수요연동: from의 수요 증감이 to의 수요를 직접 결정
- 리스크: from이 to에게 위협·부정적 영향
- 양방향: 서로 영향을 주고받는 대등 관계
- 포함관계: to는 from의 하위 범주·구성요소
- 무관계: 함께 언급되지만 실질적 관계 없음

출력: {"results": [{"id": <int>, "relation_type": "<유형>", "relation_desc": "<한 문장>"}, ...]}
- relation_desc는 "from이 to에 ~한다/~를 결정한다" 형태
- 위 8가지 유형 중 하나만 선택"""


def fetch_paged(url_base: str) -> list:
    """Supabase REST API 페이지네이션 (1000건 limit 우회)"""
    result = []
    offset = 0
    PAGE = 1000
    while True:
        res = requests.get(f"{url_base}&offset={offset}&limit={PAGE}", headers={**HDR, "Prefer": "count=none"})
        res.raise_for_status()
        batch = res.json()
        result.extend(batch)
        if len(batch) < PAGE:
            break
        offset += PAGE
    return result


def fetch_all_entities() -> dict:
    rows = fetch_paged(f"{SUPABASE_URL}/rest/v1/entities?select=id,name,type&order=id.asc")
    return {e["id"]: e for e in rows}


def fetch_relations() -> list:
    return fetch_paged(
        f"{SUPABASE_URL}/rest/v1/entity_relations"
        f"?select=id,from_entity_id,to_entity_id,weight"
        f"&weight=gte.3&relation_type=is.null&order=weight.desc"
    )


def call_gpt(batch: list, entities: dict) -> list:
    lines = []
    for r in batch:
        fe = entities.get(r["from_entity_id"], {})
        te = entities.get(r["to_entity_id"], {})
        lines.append(
            f'id={r["id"]} | {fe.get("name","?")}({fe.get("type","?")}) → '
            f'{te.get("name","?")}({te.get("type","?")}) | 공동출현={int(r["weight"])}'
        )
    user_msg = "아래 관계를 분석해줘:\n\n" + "\n".join(lines)

    resp = client.chat.completions.create(
        model="gpt-4.1-mini",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user",   "content": user_msg},
        ],
        max_tokens=1200,
        temperature=0,
    )
    raw = json.loads(resp.choices[0].message.content)
    return raw.get("results", raw) if isinstance(raw, dict) else raw


def update_batch(items: list):
    for item in items:
        rid   = item.get("id")
        rtype = (item.get("relation_type") or "").strip()
        rdesc = (item.get("relation_desc") or "").strip()
        if not rid or rtype not in RELATION_TYPES:
            continue
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/entity_relations?id=eq.{rid}",
            headers={**HDR, "Prefer": "return=minimal"},
            json={"relation_type": rtype, "relation_desc": rdesc},
        )
        if r.status_code not in (200, 204):
            print(f"  [WARN] id={rid} 업데이트 실패: {r.text[:80]}")


def main():
    print("엔티티 목록 로드 중...")
    entities = fetch_all_entities()
    print(f"  엔티티 {len(entities)}개 로드 완료")

    print("관계 데이터 로드 중 (weight>=3, null)...")
    relations = fetch_relations()
    total = len(relations)
    print(f"  대상 {total}건\n")

    BATCH = 20
    n_batches = math.ceil(total / BATCH)
    success = fail = 0
    t0 = time.time()

    for i in range(n_batches):
        batch = relations[i*BATCH:(i+1)*BATCH]
        elapsed = time.time() - t0
        eta = (elapsed / (i+1)) * (n_batches - i - 1) if i > 0 else 0
        print(f"[{i+1:3d}/{n_batches}] {(i+1)/n_batches*100:.0f}%  "
              f"경과 {elapsed:.0f}s  남은 예상 {eta:.0f}s", end="  ")

        try:
            results = call_gpt(batch, entities)
            update_batch(results)
            success += len(results)
            print(f"OK {len(results)}건")
        except Exception as e:
            fail += len(batch)
            print(f"FAIL {e}")

        if i < n_batches - 1:
            time.sleep(0.4)

    elapsed = time.time() - t0
    print(f"\n완료: 성공 {success}건 / 실패 {fail}건 / 전체 {total}건 / {elapsed:.0f}초")


if __name__ == "__main__":
    main()
