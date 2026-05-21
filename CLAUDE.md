# SemiCon 프로젝트

반도체 뉴스레터 웹사이트 + AI 에이전트 시황 채팅방.

## 기술 스택

- **Next.js 15** (App Router), TypeScript, Tailwind CSS v4
- **Tailwind v4 주의**: `postcss.config.mjs`에서 `@tailwindcss/postcss` 사용 (v3 방식 아님)
- **Supabase**: `@supabase/supabase-js` + `@supabase/ssr`
- 카카오 OAuth (Supabase provider), 토스페이먼츠 결제 (현재 미사용)
- **Python FastAPI** WebSocket 서버 (`agents_server.py`, 포트 8765)
- **Ollama** 로컬 LLM: 현재 `qwen2.5:7b`

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
├── page.tsx                  홈
├── news/page.tsx             뉴스 목록 (public, client)
├── reports/page.tsx          증권리포트 목록 (public)
├── report-analysis/page.tsx  리포트 Pick — Notion 스타일 리치 에디터 (HTML 저장)
├── telegram/page.tsx         텔레그램 메시지
├── agents/page.tsx           AI 에이전트 시황 채팅 (WebSocket → localhost:8765)
├── board/                    게시판
├── payment/                  결제 UI (checkout / success / fail) — 현재 미사용
└── auth/callback/route.ts    카카오 OAuth 콜백
```

## API 라우트

```
app/api/
├── payment/confirm/          토스페이먼츠 결제 승인
├── report-pages/             리포트 Pick 페이지 CRUD
├── board/                    게시판 CRUD + 이미지 업로드
├── stocks/                   주가 데이터
└── relative-performance/     상대 수익률
```

## Supabase

- **Project ref**: `zpfcxfzxqpprtcjmzosc`
- **URL**: `https://zpfcxfzxqpprtcjmzosc.supabase.co`
- 클라이언트: `lib/supabase/client.ts` (브라우저), `lib/supabase/server.ts` (서버)
- `middleware.ts`: 세션 갱신용 — `getUser()` 호출 필수, 삭제하면 인증 깨짐

### 주요 테이블

| 테이블 | 용도 |
|--------|------|
| `news` | 뉴스 기사 |
| `stock_reports` | 증권사 리포트 |
| `telegram_messages` | 텔레그램 메시지 |
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
```
