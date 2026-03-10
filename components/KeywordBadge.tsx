interface KeywordBadgeProps {
  keyword: string;
  onClick?: () => void;
  active?: boolean;
}

const colorMap: Record<string, string> = {
  메모리: "bg-blue-50 text-blue-700 border-blue-200",
  파운드리: "bg-purple-50 text-purple-700 border-purple-200",
  HBM: "bg-green-50 text-green-700 border-green-200",
  반도체: "bg-slate-50 text-slate-700 border-slate-200",
  AI: "bg-orange-50 text-orange-700 border-orange-200",
  삼성전자: "bg-cyan-50 text-cyan-700 border-cyan-200",
  SK하이닉스: "bg-rose-50 text-rose-700 border-rose-200",
};

export default function KeywordBadge({ keyword, onClick, active }: KeywordBadgeProps) {
  const color = colorMap[keyword] ?? "bg-slate-50 text-slate-600 border-slate-200";
  const base = "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border";
  const interactive = onClick ? "cursor-pointer hover:opacity-80 transition-opacity" : "";
  const activeStyle = active ? "ring-2 ring-blue-400 ring-offset-1" : "";

  return (
    <span
      className={`${base} ${color} ${interactive} ${activeStyle}`}
      onClick={onClick}
    >
      {keyword}
    </span>
  );
}
