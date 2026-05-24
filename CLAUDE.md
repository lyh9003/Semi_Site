# SemiCon 프로젝트

반도체 뉴스레터 웹사이트 + AI 에이전트 시황 채팅방 + RAG Q&A 챗봇 + 일일 브리핑.

## 기술 스택

- **Next.js 15** (App Router), TypeScript, Tailwind CSS v4
- **Tailwind v4 주의**: `postcss.config.mjs`에서 `@tailwindcss/postcss` 사용 (v3 방식 아님)
- **Supabase**: `@supabase/supabase-js` + `@supabase/ssr`
- 카카오 OAuth (Supabase provider), 토스페이먼츠 결제 (현재 미사용)
- **Python FastAPI** WebSocket 서버 (`agents_server.py`, 포트 8765)
- **Ollama** 로컬 LLM: 현재 `qwen2.5:7b`
- **OpenAI**: `text-embedding-3-small` (임베딩), `gpt-4o-mini` (답변·분류·요약)

## 배포

- Next.js → Vercel (`semi-site.vercel.app`)
- `agents_server.py` → 사용자 로컬 머신에서 직접 실행 (브라우저가 `ws://localhost:8765/ws`로 연결)

## 접근 권한

| 메뉴 | 권한 |
|------|------|
| 뉴스 목록 | 공개 |
| 증권리포트 열람·다운로드 | 공개 (구독 제한 제거됨) |
| 리포트 Pick 편집 | 어드민 (`NEXT_PUBLIC_ADMIN_EMAIL`) |

## 주요 라우트

```
app/
├── page.tsx                  홈 (DailyBriefing 컴포넌트 포함)
├── news/page.tsx             뉴스 목록 (public, client)
├── reports/page.tsx          증권리포트 목록 (public)
├── report-analysis/page.tsx  리포트 Pick — Notion 스타일 리치 에디터 (HTML 저장)
├── telegram/page.tsx         텔레그램 메시지
├── insight/page.tsx          인사이트 — 키워드/의미 유사도 교차 참조
├── graph/page.tsx            지식 그래프 D3.js 시각화
├── ask/page.tsx              반도체 시황 Q&A (RAG 챗봇)
├── agents/page.tsx           AI 에이전트 시황 채팅 (WebSocket → localhost:8765)
├── board/                    게시판
├── payment/                  결제 UI (checkout / success / fail) — 현재 미사용
└── auth/callback/route.ts    카카오 OAuth 콜백
```

## API 라우트

```
app/api/
├── chat/                     RAG Q&A — 임베딩→pgvector 검색→gpt-4o-mini 스트리밍
├── briefing/                 일일 시황 브리핑 (GET, 1시간 캐시)
├── graph/route.ts            지식 그래프 노드·엣지 데이터
├── graph/entity/             엔티티별 최신 뉴스·리포트·텔레그램
├── graph/summary/            엔티티 AI 시황 요약 (gpt-4o-mini 스트리밍)
├── insight/similar/          pgvector 의미 유사도 검색
├── payment/confirm/          토스페이먼츠 결제 승인
├── report-pages/             리포트 Pick 페이지 CRUD
├── board/                    게시판 CRUD + 이미지 업로드
├── stocks/                   주가 데이터
└── relative-performance/     상대 수익률
```

## RAG Q&A 시스템 (`app/api/chat/route.ts`)

### 흐름
1. 질문을 `gpt-4o-mini`로 분류: `"recent"` (최신 14일) vs `"general"` (전체 시맨틱)
2. 동시에 `text-embedding-3-small`로 질문 임베딩 생성
3. 분기:
   - `recent`: `match_news_recent` / `match_reports_recent` / `match_telegrams_recent` (since_days=14)
   - `general`: `match_news` / `match_reports` / `match_telegrams`
4. `Promise.allSettled`로 검색 — 일부 실패해도 나머지 결과 사용
5. NDJSON 스트리밍: `{type:"sources",...}\n` → `{type:"text",data:"chunk"}\n`
6. 프론트에서 `searchErrors` 배지로 검색 오류 표시

### 핵심 설계 원칙
- **임베딩 비대칭 문제**: 짧은 질문 vs 긴 문서 임베딩은 유사도가 낮음 → threshold 필터 없이 `ORDER BY embedding <=> query_embedding LIMIT n` 사용
- **HNSW 호환**: WHERE절 threshold 필터는 HNSW 인덱스를 비활성화하고 seq scan 유발 → 제거
- **recent 모드**: 날짜 인덱스(`news_date_idx`) 활용, 최근 200건만 가져와 유사도 정렬

### Supabase SQL 함수 (현재 상태)
- `match_news`, `match_reports`, `match_telegrams`: 순수 HNSW `ORDER BY embedding <=> query_embedding LIMIT n`
- `match_news_recent`, `match_reports_recent`, `match_telegrams_recent`:
  ```sql
  SELECT ... FROM (
    SELECT ..., 1 - (embedding <=> query_embedding) AS similarity
    FROM news
    WHERE embedding IS NOT NULL
      AND date >= CURRENT_DATE - (since_days || ' days')::interval
    ORDER BY date DESC LIMIT 200
  ) recent_sample
  ORDER BY similarity DESC LIMIT match_count;
  ```
- `get_entity_docs`: 엔티티별 최신 문서 10건 반환 (날짜 DESC 정렬)

### DB 인덱스
- `news_date_idx`: `CREATE INDEX ON news(date DESC)` — recent 모드 seq scan 타임아웃 방지용
- HNSW 인덱스: `news`, `stock_reports`, `telegram_messages`의 `embedding` 컬럼

### 리포트 필드 주의
- **항상 `summary` 사용** (`one_line_summary` 아님)
- 관련 파일: `app/api/chat/route.ts`, `app/api/briefing/route.ts`, `app/api/graph/summary/route.ts`

## 일일 브리핑 (`app/api/briefing/route.ts` + `components/DailyBriefing.tsx`)

- GET 요청, `Cache-Control: s-maxage=3600`으로 Vercel 엣지 캐시
- 뉴스: `importance=eq.3` + `order=date.desc` + `limit=10`
- 리포트: `order=date.desc` + `limit=5`, `summary` 필드 사용
- 텔레그램: `order=date_utc.desc,forward_count.desc` + `limit=10`
- 수동 새로고침: `?t=${Date.now()}` + `cache: "no-store"`로 캐시 우회

## Supabase

- **Project ref**: `zpfcxfzxqpprtcjmzosc`
- **URL**: `https://zpfcxfzxqpprtcjmzosc.supabase.co`
- 클라이언트: `lib/supabase/client.ts` (브라우저), `lib/supabase/server.ts` (서버)
- `middleware.ts`: 세션 갱신용 — `getUser()` 호출 필수, 삭제하면 인증 깨짐

### 주요 테이블

| 테이블 | 용도 |
|--------|------|
| `news` | 뉴스 기사 (~30,000건, embedding 컬럼 포함) |
| `stock_reports` | 증권사 리포트 (~584건, embedding 컬럼 포함, `summary` 사용) |
| `telegram_messages` | 텔레그램 메시지 (~5,558건, embedding 컬럼 포함) |
| `entities` | 지식 그래프 엔티티 (2,121개) |
| `entity_mentions` | 엔티티 멘션 (47,609건) |
| `entity_relations` | 엔티티 관계 (9,537건) |
| `report_pages` | 리포트 Pick 페이지 (content는 HTML) |
| `subscriptions` | 구독 정보 (현재 미사용) |
| `board_posts` | 게시판 |

## 타입 정의

`lib/types.ts`: `News`, `StockReport`, `TelegramMessage`, `BoardPost`, `Subscription`

## agents_server.py 구조

로컬에서 실행하는 Python FastAPI WebSocket 서버.

```
실행: python agents_server.py  또는  .\start_agents.ps1
포트: 8765
모델: qwen2.5:7b (Ollama, localhost:11434)
```

### 핵심 흐름

1. 시작 시 Supabase REST API로 데이터 로드 (뉴스 30, 텔레그램 30, 리포트 20, 분석 12)
2. 30틱(약 5분)마다 데이터 갱신
3. 에이전트 5개가 순환하며 Ollama로 메시지 생성 → WebSocket broadcast
4. 15~20틱마다 "현재 시황이 어떻지?" 주입으로 대화 환기
5. 논쟁적 발언 감지 시 버스트 모드 (1명 추가 반응)

### 에이전트 5개

| id | 이름 | focus |
|----|------|-------|
| bull | 강세론자 | news, reports |
| bear | 약세론자 | telegram, analysis |
| risk | 리스크 | telegram, news |
| analyst | 애널리스트 | reports, analysis |
| macro | 매크로 | news, analysis |

### 주의사항

- `.env.local`에서 Supabase 키 읽어 REST API 직접 호출 (SDK 미사용)
- 한자(CJK) 감지 시 1회 재시도 후 건너뜀 (`has_cjk()` 정규식)
- 타임아웃 35초, `num_predict: 200`
- gemma4:e4b는 한국어 미지원 — qwen2.5:7b 사용 유지
- 포트 충돌 시: `netstat -ano | findstr :8765` → `taskkill /PID <PID> /F`

## 환경변수 (.env.local)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_KAKAO_CLIENT_ID=
NEXT_PUBLIC_TOSS_CLIENT_KEY=
TOSS_SECRET_KEY=
NEXT_PUBLIC_ADMIN_EMAIL=
OPENAI_API_KEY=
```
