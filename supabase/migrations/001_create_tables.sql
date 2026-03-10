-- ============================================
-- 1. 뉴스 테이블 (공개 읽기)
-- ============================================
create table if not exists news (
  id bigserial primary key,
  date date,
  title text,
  company text,
  link text,
  content text,
  relevance text,
  keyword text,
  summary text,
  search_term text,
  created_at timestamptz default now()
);

alter table news enable row level security;

create policy "public read news"
  on news for select
  using (true);

-- ============================================
-- 2. 증권 리포트 테이블 (로그인 사용자만 읽기)
-- ============================================
create table if not exists stock_reports (
  id bigserial primary key,
  date date,
  securities_firm text,
  title text,
  content text,
  summary text,
  one_line_summary text,
  keyword text,
  link text,
  file_size text,
  created_at timestamptz default now()
);

alter table stock_reports enable row level security;

create policy "auth read stock_reports"
  on stock_reports for select
  using (auth.role() = 'authenticated');

-- ============================================
-- 3. 구독 테이블
-- ============================================
create table if not exists subscriptions (
  id bigserial primary key,
  user_id uuid references auth.users not null,
  kakao_tid text,
  status text default 'active' check (status in ('active', 'cancelled', 'expired')),
  started_at timestamptz default now(),
  expires_at timestamptz,
  created_at timestamptz default now()
);

alter table subscriptions enable row level security;

create policy "user own subscription read"
  on subscriptions for select
  using (auth.uid() = user_id);

create policy "user own subscription insert"
  on subscriptions for insert
  with check (auth.uid() = user_id);
