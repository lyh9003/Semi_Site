import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import NewsCard from "@/components/NewsCard";
import ReportCard from "@/components/ReportCard";
import StockChart from "@/components/StockChart";
import RelativeChart from "@/components/RelativeChart";

export const revalidate = 3600; // 1시간마다 재생성

export default async function HomePage() {
  const supabase = await createClient();

  const { data: latestNews } = await supabase
    .from("news")
    .select("*")
    .eq("importance", 3)
    .order("date", { ascending: false })
    .limit(6);

  const { count: reportCount } = await supabase
    .from("stock_reports")
    .select("id", { count: "exact", head: true });

  const { data: latestReport } = await supabase
    .from("stock_reports")
    .select("*")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  const { count: newsCount } = await supabase
    .from("news")
    .select("id", { count: "exact", head: true });

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* 히어로 섹션 */}
      <section className="text-center pt-6 pb-4 mb-6">
        <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-600 text-xs font-medium px-3 py-1.5 rounded-full mb-3 border border-blue-100">
          <span>⬡</span>
          <span>반도체 산업 전문 뉴스레터</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 mb-4 leading-tight">
          <span className="text-blue-600">SemiCon Weekly</span>
        </h1>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/news"
            className="w-full sm:w-auto text-center px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
          >
            뉴스 보기 →
          </Link>
          <Link
            href="/reports"
            className="w-full sm:w-auto text-center px-6 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-xl border border-slate-200 transition-colors"
          >
            증권 리포트 보기
          </Link>
          <Link
            href="/telegram"
            className="w-full sm:w-auto text-center px-6 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-xl border border-slate-200 transition-colors"
          >
            텔레그램 보기
          </Link>
        </div>
      </section>

      {/* 통계 */}
      <section className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "수집된 뉴스", value: `${newsCount ?? 0}+`, icon: "📰" },
          { label: "증권 리포트", value: `${reportCount ?? 0}+`, icon: "📊" },
          { label: "커버 키워드", value: "50+", icon: "🏷️" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5 text-center">
            <div className="text-2xl sm:text-3xl mb-1 sm:mb-2">{stat.icon}</div>
            <div className="text-lg sm:text-2xl font-bold text-slate-800">{stat.value}</div>
            <div className="text-xs sm:text-sm text-slate-500 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </section>

      {/* 주가 차트 */}
      <StockChart />

      {/* 상대 수익률 차트 */}
      <RelativeChart />

      {/* 최신 뉴스 */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg sm:text-xl font-bold text-slate-800">최신 반도체 뉴스</h2>
          <Link href="/news" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            전체 보기 →
          </Link>
        </div>

        {latestNews && latestNews.length > 0 ? (
          <div className="flex flex-col gap-3">
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

      {/* 최신 증권 리포트 */}
      <section className="mt-10 sm:mt-12">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg sm:text-xl font-bold text-slate-800">최신 증권 리포트</h2>
          <Link href="/reports" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            전체 보기 →
          </Link>
        </div>
        {latestReport ? (
          <ReportCard report={latestReport} />
        ) : (
          <div className="text-center py-12 text-slate-400">
            <p className="text-4xl mb-3">📭</p>
            <p>아직 리포트가 없습니다.</p>
          </div>
        )}
      </section>
    </div>
  );
}
