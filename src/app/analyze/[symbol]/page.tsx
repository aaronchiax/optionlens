import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Suspense } from "react";
import { AnalyzeView } from "@/components/AnalyzeView";

// Static export (GitHub Pages): pre-render one page per ticker in the published snapshot.
// In server mode this returns [] and any ticker is rendered on demand.
export function generateStaticParams() {
  if (process.env.STATIC_EXPORT !== "1") return [];
  try {
    const idx = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "index.json"), "utf8"));
    return (idx.tickers as { symbol: string }[]).map((t) => ({ symbol: t.symbol }));
  } catch {
    throw new Error("STATIC_EXPORT=1 requires public/data/index.json — run market-data-service/snapshot.py first.");
  }
}

export default async function AnalyzePage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  return (
    <Suspense>
      <AnalyzeView key={sym} symbol={sym} />
    </Suspense>
  );
}
