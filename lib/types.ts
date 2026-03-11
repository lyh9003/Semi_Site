export interface News {
  id: number;
  date: string;
  title: string;
  company: string;
  link: string;
  content: string;
  relevance: string;
  keyword: string;
  summary: string;
  search_term: string;
}

export interface StockReport {
  id: number;
  date: string;
  source: string;
  securities_firm: string;
  title: string;
  target_price: string | null;
  content: string;
  summary: string;
  one_line_summary: string;
  keyword: string;
  link: string;
  file_size: string;
}

export interface Subscription {
  id: number;
  user_id: string;
  kakao_tid: string;
  status: "active" | "cancelled" | "expired";
  started_at: string;
  expires_at: string;
}
