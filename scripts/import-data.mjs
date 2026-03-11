/**
 * CSV 데이터를 Supabase에 임포트하는 스크립트
 * 실행: node scripts/import-data.mjs
 *
 * 먼저 .env.local 파일에 환경변수를 설정해야 합니다.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role key 필요

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("환경변수를 설정해주세요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// 멀티라인 quoted field를 올바르게 처리하는 전체 텍스트 CSV 파서
function parseCSV(text) {
  const rows = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const row = [];
    while (i < n) {
      let field = "";
      if (text[i] === '"') {
        i++; // opening quote
        while (i < n) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2; }
            else { i++; break; } // closing quote
          } else {
            field += text[i++];
          }
        }
      } else {
        while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i++];
        }
      }
      row.push(field.trim());
      if (i >= n || text[i] === '\n' || text[i] === '\r') break;
      if (text[i] === ',') i++; // skip comma
    }
    // skip \r\n or \n
    if (i < n && text[i] === '\r') i++;
    if (i < n && text[i] === '\n') i++;
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) rows.push(row);
  }
  return rows;
}

async function importNews() {
  console.log("뉴스 데이터 임포트 시작...");
  const NEWS_URL = "https://raw.githubusercontent.com/lyh9003/yong/main/Total_Filtered_No_Comment.csv";

  const response = await fetch(NEWS_URL);
  const text = await response.text();
  const allRows = parseCSV(text.replace(/^\uFEFF/, ""));
  const headers = allRows[0];
  console.log("뉴스 CSV 헤더:", headers);

  const rows = [];
  for (let i = 1; i < allRows.length; i++) {
    const values = allRows[i];
    if (values.length < 2) continue;
    rows.push({
      date: values[0] || null,
      title: values[1] || null,
      company: values[2] || null,
      link: values[3] || null,
      content: values[4] || null,
      relevance: values[5] || null,
      keyword: values[6] || null,
      summary: values[7] || null,
      search_term: values[8] || null,
    });
  }

  console.log(`총 ${rows.length}개 뉴스 데이터 삽입 중...`);
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from("news").upsert(batch, { onConflict: "link", ignoreDuplicates: true });
    if (error) console.error(`뉴스 배치 ${i}~${i + BATCH} 오류:`, error.message);
    else console.log(`뉴스 ${i + batch.length}/${rows.length} 완료`);
  }
  console.log("뉴스 임포트 완료!");
}

async function importReports() {
  console.log("증권 리포트 데이터 임포트 시작...");
  const REPORTS_URL = "https://raw.githubusercontent.com/lyh9003/stock_report/main/reports.csv";

  const response = await fetch(REPORTS_URL);
  const text = await response.text();
  const allRows = parseCSV(text.replace(/^\uFEFF/, ""));
  const headers = allRows[0];
  console.log("리포트 CSV 헤더:", headers);

  // 헤더 기반 매핑 (칼럼 추가에 유연하게 대응)
  const headerMap = {};
  headers.forEach((h, i) => { headerMap[h] = i; });
  const col = (values, name) => values[headerMap[name]] || null;

  const rows = [];
  for (let i = 1; i < allRows.length; i++) {
    const values = allRows[i];
    if (values.length < 2) continue;
    rows.push({
      date: col(values, "날짜"),
      source: col(values, "출처"),
      securities_firm: col(values, "증권사"),
      title: col(values, "레포트제목"),
      target_price: col(values, "목표주가"),
      content: col(values, "레포트본문전체"),
      summary: col(values, "전체요약"),
      one_line_summary: col(values, "1줄 요약"),
      keyword: col(values, "키워드"),
      link: col(values, "link"),
      file_size: col(values, "파일크기"),
    });
  }

  console.log(`총 ${rows.length}개 리포트 데이터 삽입 중...`);
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from("stock_reports").upsert(batch, { onConflict: "link", ignoreDuplicates: false });
    if (error) console.error(`리포트 배치 ${i}~${i + BATCH} 오류:`, error.message);
    else console.log(`리포트 ${i + batch.length}/${rows.length} 완료`);
  }
  console.log("리포트 임포트 완료!");
}

(async () => {
  await importNews();
  await importReports();
  console.log("모든 데이터 임포트 완료!");
})();
