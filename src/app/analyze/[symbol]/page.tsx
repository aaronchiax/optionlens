import { AnalyzeView } from "@/components/AnalyzeView";

export default async function AnalyzePage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { symbol } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return (
    <AnalyzeView
      key={`${symbol}-${one("source") ?? ""}`}
      symbol={decodeURIComponent(symbol).toUpperCase()}
      simulated={one("source") === "simulated"}
      initial={{ target: one("target"), horizon: one("horizon"), outlook: one("outlook"), pref: one("pref"), cap: one("cap"), loss: one("loss"), vol: one("vol") }}
    />
  );
}
