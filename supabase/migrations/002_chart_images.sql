-- chart_images 테이블: 홈페이지에 표시할 차트 이미지 2개 슬롯
CREATE TABLE IF NOT EXISTS chart_images (
  slot    INTEGER PRIMARY KEY CHECK (slot IN (1, 2)),
  url     TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기본 슬롯 2개 미리 생성
INSERT INTO chart_images (slot) VALUES (1), (2)
  ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE chart_images ENABLE ROW LEVEL SECURITY;

-- 누구나 읽기 가능
CREATE POLICY "public read chart_images" ON chart_images
  FOR SELECT USING (true);

-- 서비스 롤(API 라우트)만 쓰기 가능 (service_role key bypass RLS anyway)
CREATE POLICY "service write chart_images" ON chart_images
  FOR ALL USING (auth.role() = 'service_role');

-- Storage 버킷 생성 (이미 있으면 무시됨)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('chart-images', 'chart-images', true)
  ON CONFLICT (id) DO NOTHING;

-- Storage 공개 읽기 정책
CREATE POLICY "Public read chart-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chart-images');
