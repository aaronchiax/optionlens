import { StockSearch } from "@/components/StockSearch";

export default function AnalyzeIndex() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Analyze a stock</h1>
      <p className="mt-3 text-ink-2">Search by ticker or company name to load market data and the options chain.</p>
      <div className="mt-8">
        <StockSearch autoFocus />
      </div>
    </div>
  );
}
