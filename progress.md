# Graph RAG 인사이트 시스템 개발 진행

## 목표

뉴스·증권리포트·텔레그램의 파편화된 정보를 연결해 메모리 반도체 시황을 시각화한다.
각 정보 소스 간 인과·상관관계를 탐색하고, LLM으로 종합 시황을 요약한다.

---

## 로드맵

```
Phase 1  키워드 기반 교차 참조     ← 현재 작업 중
Phase 2  pgvector 의미 유사도
Phase 3  지식 그래프 구축
Phase 4  그래프 시각화 + 자연어 질의
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

## Phase 3 — 지식 그래프 구축 (예정)

**목표**: 엔티티(기업·지표·이벤트)를 노드로, 공동 출현·인과관계를 엣지로 연결

**할 일**:
- [ ] Supabase에 `entities`, `entity_relations` 테이블 추가
- [ ] Ollama로 각 문서에서 엔티티 추출 배치 스크립트 작성
- [ ] 관계 분류: mentions / causes / contradicts / corroborates
- [ ] 그래프 탐색 API 작성

**테이블 설계**:
```sql
create table entities (
  id serial primary key,
  name text not null,
  type text, -- company / metric / event / product
  source_type text, -- news / report / telegram
  source_id int,
  created_at timestamptz default now()
);

create table entity_relations (
  id serial primary key,
  from_entity_id int references entities(id),
  to_entity_id int references entities(id),
  relation_type text, -- mentions / causes / contradicts
  weight float default 1.0,
  created_at timestamptz default now()
);
```

---

## Phase 4 — 시각화 + 자연어 질의 (예정)

**목표**: D3.js 그래프 + "삼성전자 목표주가 상향 근거는?" 같은 자연어 질의

**할 일**:
- [ ] D3.js force-directed graph 컴포넌트 작성
- [ ] 노드 클릭 → 관련 문서 표시
- [ ] 자연어 질의 입력 → 그래프 탐색 → Ollama 합성 답변
- [ ] 시황 요약 자동 생성 (에이전트 서버 연동 가능성)

---

## 데이터 현황

| 소스 | 테이블 | 키워드 컬럼 | 건수 |
|------|--------|------------|------|
| 뉴스 | `news` | `keyword` | ~수백 |
| 증권리포트 | `stock_reports` | `keyword` | ~수백 |
| 텔레그램 | `telegram_messages` | `keywords` | ~수백 |
| 리포트Pick | `report_pages` | 없음(HTML) | ~12챕터 |

## 기술 스택

- Frontend: Next.js 15, TypeScript, Tailwind CSS v4
- DB: Supabase (PostgreSQL + pgvector 예정)
- LLM: Ollama qwen2.5:7b (로컬)
- 그래프 시각화: D3.js (Phase 4)
- Graph RAG: 자체 구현 (Supabase + Ollama)
