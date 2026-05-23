-- Phase 2: pgvector 임베딩 기반 의미 유사도 검색
-- Supabase 대시보드 SQL Editor에서 실행

-- 1. pgvector 확장 활성화
create extension if not exists vector;

-- 2. 임베딩 컬럼 추가 (nomic-embed-text 기준 768차원)
alter table news add column if not exists embedding vector(768);
alter table stock_reports add column if not exists embedding vector(768);
alter table telegram_messages add column if not exists embedding vector(768);

-- 3. HNSW 인덱스 (코사인 유사도 기준, 수백~수천 건 수준에서 최적)
-- 데이터가 1000건 이하라면 인덱스 없어도 무방하지만 미리 생성
create index if not exists news_embedding_idx
  on news using hnsw (embedding vector_cosine_ops);

create index if not exists reports_embedding_idx
  on stock_reports using hnsw (embedding vector_cosine_ops);

create index if not exists telegram_embedding_idx
  on telegram_messages using hnsw (embedding vector_cosine_ops);

-- 4. 유사 뉴스 검색 RPC
create or replace function match_news(
  query_embedding vector(768),
  match_threshold float default 0.4,
  match_count int default 6
)
returns table (
  id int,
  title text,
  company text,
  date text,
  summary text,
  keyword text,
  link text,
  similarity float
)
language sql stable as $$
  select
    n.id,
    n.title,
    n.company,
    n.date::text,
    n.summary,
    n.keyword,
    n.link,
    1 - (n.embedding <=> query_embedding) as similarity
  from news n
  where n.embedding is not null
    and 1 - (n.embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
$$;

-- 5. 유사 증권리포트 검색 RPC
create or replace function match_reports(
  query_embedding vector(768),
  match_threshold float default 0.4,
  match_count int default 6
)
returns table (
  id int,
  title text,
  securities_firm text,
  date text,
  one_line_summary text,
  keyword text,
  link text,
  target_price text,
  similarity float
)
language sql stable as $$
  select
    r.id,
    r.title,
    r.securities_firm,
    r.date::text,
    r.one_line_summary,
    r.keyword,
    r.link,
    r.target_price::text,
    1 - (r.embedding <=> query_embedding) as similarity
  from stock_reports r
  where r.embedding is not null
    and 1 - (r.embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
$$;

-- 6. 유사 텔레그램 검색 RPC
create or replace function match_telegrams(
  query_embedding vector(768),
  match_threshold float default 0.4,
  match_count int default 6
)
returns table (
  id int,
  channel text,
  summary text,
  keywords text,
  sentiment text,
  forward_count int,
  date_utc text,
  similarity float
)
language sql stable as $$
  select
    t.id,
    t.channel,
    t.summary,
    t.keywords,
    t.sentiment,
    t.forward_count,
    t.date_utc::text,
    1 - (t.embedding <=> query_embedding) as similarity
  from telegram_messages t
  where t.embedding is not null
    and 1 - (t.embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
$$;
