-- 게시판 테이블
CREATE TABLE IF NOT EXISTS board_posts (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  views INTEGER DEFAULT 0 NOT NULL
);

-- RLS 비활성화 (서비스 롤로만 접근)
ALTER TABLE board_posts DISABLE ROW LEVEL SECURITY;

-- 조회수 업데이트 함수
CREATE OR REPLACE FUNCTION increment_board_views(post_id BIGINT)
RETURNS void AS $$
  UPDATE board_posts SET views = views + 1 WHERE id = post_id;
$$ LANGUAGE sql;
