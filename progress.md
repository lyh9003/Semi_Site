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
Phase 5  RAG 시황 Q&A 챗봇        ← 다음 작업
Phase 6  엔티티 AI 시황 요약       예정
Phase 7  홈 화면 일일 브리핑       예정
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

**한계**:
- 키워드가 DB에 없거나 형태가 다르면 연결 안 됨 (예: "삼성" vs "삼성전자")
- 의미적으로 관련돼도 키워드 불일치 시 누락
- → Phase 2에서 pgvector로 보완

---

## Phase 2 — pgvector 의미 유사도

**목표**: 키워드 불일치 상황에서도 의미적으로 유사한 항목 연결

**상태**: ✅ 완료

**구현 내용**:
- SQL: `supabase/migrations/003_add_embeddings.sql` — pgvector 확장, 벡터 컬럼, HNSW 인덱스, RPC 3개
- 임베딩 생성: `generate_embeddings.py` — Ollama `nomic-embed-text` 모델, 증분 처리
- API 라우트: `app/api/insight/similar/route.ts` — 저장된 임베딩으로 RPC 호출 (Vercel 동작)
- UI: insight 페이지에 "키워드 매칭 / 의미 유사도" 모드 전환 버튼 추가

**완료된 작업**:
- ✅ Supabase pgvector 확장 + vector(1536) 컬럼 추가 (news, stock_reports, telegram_messages)
- ✅ HNSW 인덱스 생성
- ✅ match_news / match_reports / match_telegrams RPC 함수 생성
- ✅ OpenAI text-embedding-3-small 기반 generate_embeddings.py 작성
- ✅ .env.local에 OPENAI_API_KEY 저장
- ✅ app/api/insight/similar/route.ts 작성 (Vercel 호환)

**임베딩 결과** (2026-05-23):
- 뉴스 1,000건 / 리포트 584건 / 텔레그램 1,000건 모두 성공

**파일**:
- `supabase/migrations/003_add_embeddings.sql`
- `generate_embeddings.py`
- `app/api/insight/similar/route.ts`
- `app/insight/page.tsx` (업데이트)

**Supabase SQL 예시**:
```sql
create extension if not exists vector;
alter table news add column embedding vector(768);

create or replace function match_news(query_embedding vector(768), match_threshold float, match_count int)
returns table(id int, title text, similarity float)
language sql stable as $$
  select id, title, 1 - (embedding <=> query_embedding) as similarity
  from news
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
$$;
```

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

## Phase 5 — RAG 시황 Q&A 챗봇 ← 다음 작업

**목표**: 사용자가 자연어로 질문하면 DB 데이터를 기반으로 답변 + 출처 제공

**배경**:
- 인사이트·그래프는 탐색 도구라 사용자가 직접 클릭해야 함 → 진입장벽
- 반도체 시황을 알고 싶은 사람에게는 "질문 → 답변" 흐름이 더 직관적
- Retrieval은 이미 갖춰짐 (pgvector), Generation만 추가하면 완성

**설계**:
```
사용자 질문 입력
→ OpenAI text-embedding-3-small로 질문 임베딩
→ pgvector로 뉴스·리포트·텔레그램 각 상위 5건 검색
→ gpt-4o-mini에 검색 결과 + 질문 전달
→ 답변 생성 (출처 카드 포함)
```

**구현 계획**:
- [ ] `app/api/chat/route.ts` — 임베딩 → 검색 → gpt-4o-mini 답변 API
- [ ] `app/ask/page.tsx` — 채팅 UI (질문 입력 + 답변 + 출처 카드)
- [ ] Header에 메뉴 추가
- [ ] 시스템 프롬프트: 한국 반도체 시황 전문가 역할, 출처 인용 필수

**비용 추정**: 질문당 ~$0.001 (임베딩) + ~$0.003 (gpt-4o-mini 답변)

---

## Phase 6 — 엔티티 AI 시황 요약 (예정)

**목표**: 그래프에서 엔티티 클릭 시 관련 문서 기반 AI 요약 자동 생성

```
[삼성전자] 클릭
→ get_entity_docs RPC로 최신 문서 10건 수집
→ gpt-4o-mini로 "삼성전자 최근 동향" 한 단락 요약
→ 그래프 오른쪽 패널에 표시
```

---

## Phase 7 — 홈 화면 일일 시황 브리핑 (예정)

**목표**: 홈에 접속하면 오늘의 반도체 시황을 바로 확인

```
📊 오늘의 반도체 시황 (2026-05-24)
핵심: 엔비디아 실적 발표로 데이터센터 수요 재확인...
주목 기업: 삼성전자 ↑, SK하이닉스 ↑
키워드 급증: HBM4, Blackwell, 데이터센터 전력
```

- 매일 최신 문서를 RAG로 요약
- 홈 화면(`app/page.tsx`)에 브리핑 섹션 추가

---

## 데이터 현황 (2026-05-24)

| 소스 | 테이블 | 건수 | 임베딩 |
|------|--------|------|--------|
| 뉴스 | `news` | ~30,000 | ✅ text-embedding-3-small |
| 증권리포트 | `stock_reports` | ~584 | ✅ text-embedding-3-small |
| 텔레그램 | `telegram_messages` | ~5,558 | ✅ text-embedding-3-small |
| 엔티티 | `entities` | 2,121 | - |
| 멘션 | `entity_mentions` | 47,609 | - |
| 관계 | `entity_relations` | 9,537 | - |

## 기술 스택

- Frontend: Next.js 15, TypeScript, Tailwind CSS v4
- DB: Supabase (PostgreSQL + pgvector)
- 임베딩: OpenAI text-embedding-3-small (1536dim)
- LLM: gpt-4o-mini (엔티티 분류, Phase 5 답변 생성)
- 에이전트: Ollama qwen2.5:7b (로컬, agents_server.py)
- 그래프 시각화: D3.js
