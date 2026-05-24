# Graph RAG 인사이트 시스템 개발 진행

## 목표

뉴스·증권리포트·텔레그램의 파편화된 정보를 연결해 메모리 반도체 시황을 시각화한다.
각 정보 소스 간 인과·상관관계를 탐색하고, LLM으로 종합 시황을 요약한다.

---

## 로드맵

```
Phase 1  키워드 기반 교차 참조     ✅ 완료
Phase 2  pgvector 의미 유사도      ✅ 완료
Phase 3  지식 그래프 구축          ✅ 완료
Phase 4  그래프 시각화 (D3.js)     ✅ 완료
Phase 5  RAG 시황 Q&A 챗봇        ✅ 완료
Phase 6  엔티티 AI 시황 요약       ✅ 완료
Phase 7  홈 화면 일일 브리핑       ✅ 완료
```

---

## Phase 1 — 키워드 기반 교차 참조

**목표**: 항목 하나를 선택하면 다른 소스에서 키워드가 겹치는 관련 항목을 보여준다.

**상태**: ✅ 완료

**구현 내용**:
- 라우트: `/insight`
- 데이터 소스: `news(keyword)`, `stock_reports(keyword)`, `telegram_messages(keywords)` 각 50건
- 키워드 파싱: 쉼표·공백·#·중점 등으로 분리, lowercase 정규화
- 관련도 점수: 공통 키워드 수 (overlap score)
- UI: 왼쪽 탐색 패널(탭·검색) + 오른쪽 선택 항목 + 3컬럼 연관 항목
- 공통 키워드 노란색 배지로 강조 표시

**파일**:
- `app/insight/page.tsx` — 메인 페이지
- `components/Header.tsx` — 네비게이션에 🔗 인사이트 추가

---

## Phase 2 — pgvector 의미 유사도

**목표**: 키워드 불일치 상황에서도 의미적으로 유사한 항목 연결

**상태**: ✅ 완료

**구현 내용**:
- SQL: `supabase/migrations/003_add_embeddings.sql` — pgvector 확장, 벡터 컬럼, HNSW 인덱스, RPC 3개
- 임베딩 생성: `generate_embeddings.py` — OpenAI `text-embedding-3-small` (1536dim)
- API 라우트: `app/api/insight/similar/route.ts` — threshold=0.1 (비대칭 임베딩 고려)
- UI: insight 페이지에 "키워드 매칭 / 의미 유사도" 모드 전환 버튼 추가

**임베딩 결과** (2026-05-23):
- 뉴스 1,000건 / 리포트 584건 / 텔레그램 1,000건 모두 성공

**파일**:
- `supabase/migrations/003_add_embeddings.sql`
- `generate_embeddings.py`
- `app/api/insight/similar/route.ts`
- `app/insight/page.tsx` (업데이트)

---

## Phase 3 — 지식 그래프 구축

**목표**: 엔티티(기업·지표·이벤트)를 노드로, 공동 출현 관계를 엣지로 연결

**상태**: ✅ 완료

**구현 내용**:
- `build_knowledge_graph.py` — gpt-4o-mini로 키워드 엔티티 분류, 최근 6개월 데이터
- Supabase 테이블: `entities`(2,121개), `entity_mentions`(47,609건), `entity_relations`(9,537건)
- `mention_count` 컬럼으로 자주 언급된 엔티티 우선 정렬
- RPC `get_entity_docs` — 엔티티별 최신 문서 날짜 DESC 정렬 반환

---

## Phase 4 — 그래프 시각화 (D3.js)

**목표**: 엔티티 간 관계를 시각적으로 탐색

**상태**: ✅ 완료

**구현 내용**:
- 라우트: `/graph`
- D3.js force-directed graph — 줌·드래그·노드 클릭
- 노드 크기 = 멘션 수, 색상 = 엔티티 타입(기업/제품/지표/이벤트/섹터)
- 왼쪽 패널: 타입 필터, 최소 관계 강도 슬라이더, 검색
- 오른쪽 패널: 노드 클릭 시 최신 뉴스·리포트·텔레그램 표시
- API: `app/api/graph/route.ts`, `app/api/graph/entity/route.ts`

---

## Phase 5 — RAG 시황 Q&A 챗봇

**목표**: 사용자가 자연어로 질문하면 DB 데이터를 기반으로 답변 + 출처 제공

**상태**: ✅ 완료 (2026-05-25)

**구현 내용**:
- 라우트: `/ask`
- 질문 분류 → 검색 → gpt-4o-mini 스트리밍 답변 → 출처 카드

**핵심 설계**:
```
질문 입력
→ gpt-4o-mini (max_tokens=5)로 "recent" / "general" 분류
→ text-embedding-3-small로 질문 임베딩  (두 단계 병렬 실행)
→ recent: match_*_recent (최근 14일 데이터만)
   general: match_news / match_reports / match_telegrams (전체 시맨틱)
→ Promise.allSettled (일부 실패해도 나머지 결과 사용)
→ NDJSON 스트리밍: {type:"sources"} → {type:"text",data:"chunk"}
```

**주요 기술 해결**:
- **임베딩 비대칭**: 짧은 질문은 긴 문서와 유사도가 낮음 → threshold 제거, HNSW `ORDER BY embedding <=> query LIMIT n`
- **recent 모드 seq scan 타임아웃**: 뉴스 30k 행 풀스캔으로 57014 오류 → `news_date_idx` 생성으로 해결
- **recent 전략**: 날짜 인덱스로 최근 200건 가져온 후 유사도 정렬 (날짜 우선, 유사도 후순위)

**Supabase SQL 함수**:

일반 검색 (HNSW 활용):
```sql
CREATE OR REPLACE FUNCTION match_news(query_embedding vector(1536), match_count int)
RETURNS TABLE(...) AS $$
  SELECT id, title, company, date::text, summary, keyword, link,
         1 - (embedding <=> query_embedding) AS similarity
  FROM news
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

최근 14일 검색 (날짜 인덱스 활용):
```sql
CREATE OR REPLACE FUNCTION match_news_recent(
  query_embedding vector(1536), match_count int, since_days int DEFAULT 14)
RETURNS TABLE(...) AS $$
  SELECT id, title, company, date::text, summary, keyword, link, similarity
  FROM (
    SELECT n.id, n.title, n.company, n.date, n.summary, n.keyword, n.link,
           1 - (n.embedding <=> query_embedding) AS similarity
    FROM news n
    WHERE n.embedding IS NOT NULL
      AND n.date >= CURRENT_DATE - (since_days || ' days')::interval
    ORDER BY n.date DESC
    LIMIT 200
  ) recent_sample
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
```

**DB 인덱스**:
- `news_date_idx`: `CREATE INDEX IF NOT EXISTS news_date_idx ON news(date DESC)`

**파일**:
- `app/api/chat/route.ts` — 백엔드 (임베딩·검색·스트리밍)
- `app/ask/page.tsx` — 프론트 (질문 입력·스트리밍 답변·출처 카드)

**UI 특징**:
- 스트리밍 커서(`▌`) 실시간 표시
- 검색 전략 배지: `📅 최근 14일` / `🔍 전체 시맨틱`
- 출처 카드: 뉴스(파란), 리포트(보라), 텔레그램(청록) 색상 구분
- 검색 오류 시 `⚠️` 배지로 표시 (디버그용)
- 예시 질문 4개 첫 화면에 표시

---

## Phase 6 — 엔티티 AI 시황 요약

**목표**: 그래프에서 엔티티 클릭 시 관련 문서 기반 AI 요약 자동 생성

**상태**: ✅ 완료 (2026-05-25)

**구현 내용**:
- API: `app/api/graph/summary/route.ts`
- `get_entity_docs` RPC로 엔티티별 최신 문서 10건 수집 (뉴스 5, 리포트 5, 텔레그램 5)
- gpt-4o-mini 스트리밍으로 3~4문장 요약 생성
- 그래프 오른쪽 패널에 실시간 스트리밍 표시

---

## Phase 7 — 홈 화면 일일 시황 브리핑

**목표**: 홈에 접속하면 오늘의 반도체 시황을 바로 확인

**상태**: ✅ 완료 (2026-05-25)

**구현 내용**:
- API: `app/api/briefing/route.ts` (GET, `Cache-Control: s-maxage=3600`)
- 컴포넌트: `components/DailyBriefing.tsx` — 홈(`app/page.tsx`)에 삽입
- 데이터 수집 전략:
  - 뉴스: `importance=eq.3` + `order=date.desc` + `limit=10` (중요도 3, 최신순)
  - 리포트: `order=date.desc` + `limit=5`, `summary` 필드
  - 텔레그램: `order=date_utc.desc,forward_count.desc` + `limit=10`
- 출력 형식: `📌 핵심 요약` + `📈 주목 이슈` + `🔍 주목 키워드`
- 수동 새로고침 버튼: `?t=${Date.now()}` + `cache: "no-store"`로 캐시 우회

---

## 데이터 현황 (2026-05-25)

| 소스 | 테이블 | 건수 | 임베딩 |
|------|--------|------|--------|
| 뉴스 | `news` | ~30,000 | ✅ text-embedding-3-small (1536dim) |
| 증권리포트 | `stock_reports` | ~584 | ✅ text-embedding-3-small (1536dim) |
| 텔레그램 | `telegram_messages` | ~5,558 | ✅ text-embedding-3-small (1536dim) |
| 엔티티 | `entities` | 2,121 | - |
| 멘션 | `entity_mentions` | 47,609 | - |
| 관계 | `entity_relations` | 9,537 | - |

## 기술 스택

- Frontend: Next.js 15, TypeScript, Tailwind CSS v4
- DB: Supabase (PostgreSQL + pgvector)
- 임베딩: OpenAI text-embedding-3-small (1536dim)
- LLM: gpt-4o-mini (질문 분류, 답변 생성, 엔티티 요약, 브리핑, 엔티티 추출)
- 에이전트: Ollama qwen2.5:7b (로컬, agents_server.py)
- 그래프 시각화: D3.js

## 주요 설계 결정 사항

### 임베딩 비대칭 문제 (Phase 2, 5 공통)
짧은 질문과 긴 문서의 임베딩 유사도는 문서-문서 유사도보다 훨씬 낮다.
→ threshold 필터 없이 `ORDER BY embedding <=> query_embedding LIMIT n`만 사용.
→ `insight/similar` threshold는 0.1 (cross-type 문서 비교).

### HNSW 인덱스 + WHERE 절 충돌
pgvector HNSW 인덱스는 `ORDER BY embedding <=> query LIMIT n` 형태에서만 활성화된다.
WHERE에 similarity 필터를 추가하면 seq scan으로 fallback되어 30k 행 풀스캔 발생.

### recent 모드 전략
날짜 B-tree 인덱스(`news_date_idx`) → 최근 200건 빠르게 가져오기 → 유사도 정렬.
HNSW top-N 후 날짜 필터 방식은 오래된 문서만 뽑힐 경우 결과가 0건이 되는 문제가 있음.

### 리포트 필드 일관성
`stock_reports`의 요약 필드는 `summary`만 사용 (`one_line_summary` 컬럼은 사용 안 함).
관련 파일 전체: `api/chat`, `api/briefing`, `api/graph/summary`.
