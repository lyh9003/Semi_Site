import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import NewsCard from "@/components/NewsCard";
import StockChart from "@/components/StockChart";

export const revalidate = 3600; // 1시간마다 재생성

export default async function HomePage() {
  const supabase = await createClient();

  const { data: latestNews } = await supabase
    .from("news")
    .select("*")
    .order("date", { ascending: false })
    .limit(6);

  const { data: reportCount } = await supabase
    .from("stock_reports")
    .select("id", { count: "exact", head: true });

  const { data: newsCount } = await supabase
    .from("news")
    .select("id", { count: "exact", head: true });

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      {/* 히어로 섹션 */}
      <section className="text-center py-16 mb-12">
        <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-600 text-sm font-medium px-4 py-2 rounded-full mb-6 border border-blue-100">
          <span>⬡</span>
          <span>반도체 산업 전문 뉴스레터</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-slate-800 mb-4 leading-tight">
          반도체 시장의 모든 것,<br />
          <span className="text-blue-600">SemiCon Weekly</span>
        </h1>
        <p className="text-lg text-slate-500 max-w-2xl mx-auto mb-8">
          HBM, 메모리, 파운드리, AI 반도체까지 — 국내외 최신 뉴스와 증권사 리포트를 한 곳에서 확인하세요.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/news"
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
          >
            뉴스 보기 →
          </Link>
          <Link
            href="/reports"
            className="px-6 py-3 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-xl border border-slate-200 transition-colors"
          >
            증권 리포트 보기
          </Link>
        </div>
      </section>

      {/* 통계 */}
      <section className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-12">
        {[
          { label: "수집된 뉴스", value: `${newsCount?.length ?? 0}+`, icon: "📰" },
          { label: "증권 리포트", value: `${reportCount?.length ?? 0}+`, icon: "📊" },
          { label: "커버 키워드", value: "50+", icon: "🏷️" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-slate-200 p-5 text-center">
            <div className="text-3xl mb-2">{stat.icon}</div>
            <div className="text-2xl font-bold text-slate-800">{stat.value}</div>
            <div className="text-sm text-slate-500 mt-1">{stat.label}</div>
          </div>
        ))}
      </section>

      {/* 주가 차트 */}
      <StockChart />

      {/* 최신 뉴스 */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-800">최신 반도체 뉴스</h2>
          <Link
            href="/news"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            전체 보기 →
          </Link>
        </div>

        {latestNews && latestNews.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {latestNews.map((news) => (
              <NewsCard key={news.id} news={news} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-slate-400">
            <p className="text-4xl mb-3">📭</p>
            <p>아직 뉴스가 없습니다. 데이터를 임포트해주세요.</p>
          </div>
        )}
      </section>

      {/* 리포트 CTA */}
      <section className="mt-12 bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-8 text-white text-center">
        <h2 className="text-2xl font-bold mb-2">증권사 리포트도 확인하세요</h2>
        <p className="text-blue-100 mb-6">
          하나증권, 미래에셋 등 주요 증권사의 반도체 분석 리포트를 제공합니다.<br />
          로그인 후 열람, 구독 후 다운로드 가능합니다.
        </p>
        <Link
          href="/reports"
          className="inline-block px-6 py-3 bg-white text-blue-600 font-semibold rounded-xl hover:bg-blue-50 transition-colors"
        >
          리포트 보러가기 →
        </Link>
      </section>
    </div>
  );
}
