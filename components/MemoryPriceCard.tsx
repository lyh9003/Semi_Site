interface Props {
  message: string;
  date_local: string;
}

function parseRow(message: string, pattern: RegExp) {
  const m = message.match(pattern);
  if (!m) return null;
  return { d1: m[1], w1: m[2], m1: m[3] };
}

function PctBadge({ val }: { val: string }) {
  const trimmed = val.trim();
  const isPos = trimmed.startsWith("+");
  const isNeg = trimmed.startsWith("-");
  const cls = isPos
    ? "text-emerald-600 font-semibold"
    : isNeg
    ? "text-red-500 font-semibold"
    : "text-slate-400";
  return <span className={cls}>{trimmed}</span>;
}

export default function MemoryPriceCard({ message, date_local }: Props) {
  const ddr4 = parseRow(message, /DDR4 8Gb: 1D ([^,]+), 1W ([^,]+), 1M ([^)]+)/);
  const ddr5 = parseRow(message, /DDR5 16Gb: 1D ([^,]+), 1W ([^,]+), 1M ([^)]+)/);
  const nand = parseRow(message, /MLC 64Gb: 1D ([^,]+), 1W ([^,]+), 1M ([^)]+)/);

  if (!ddr4 && !ddr5 && !nand) return null;

  const dateStr = date_local ? date_local.slice(0, 10) : "";

  const rows = [
    { label: "DRAM DDR4 8Gb", data: ddr4 },
    { label: "DRAM DDR5 16Gb", data: ddr5 },
    { label: "NAND MLC 64Gb", data: nand },
  ].filter((r) => r.data !== null);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
        <span className="text-sm font-bold text-slate-700">메모리 스팟가격</span>
        <span className="text-xs text-slate-400">{dateStr} · DRAMeXchange</span>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map(({ label, data }) => (
          <div key={label} className="flex items-center px-4 py-2.5 gap-3">
            <span className="text-xs font-medium text-slate-600 w-32 shrink-0">{label}</span>
            <div className="flex gap-4 text-xs">
              <span className="text-slate-400 w-6">1D</span>
              <PctBadge val={data!.d1} />
              <span className="text-slate-300">|</span>
              <span className="text-slate-400 w-6">1W</span>
              <PctBadge val={data!.w1} />
              <span className="text-slate-300">|</span>
              <span className="text-slate-400 w-6">1M</span>
              <PctBadge val={data!.m1} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
