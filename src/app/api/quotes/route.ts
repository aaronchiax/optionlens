import { NextResponse } from "next/server";
import { getProvider } from "@/lib/market-data";
import { badRequest, errorResponse, sourceParam, SYMBOL_RE } from "@/lib/market-data/http";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length || symbols.length > 25 || !symbols.every((s) => SYMBOL_RE.test(s))) return badRequest("symbols=A,B,C (max 25)");
  try {
    const r = await getProvider(sourceParam(url)).getQuotes(symbols);
    return NextResponse.json({ quotes: r.data, meta: r.meta });
  } catch (e) {
    return errorResponse(e);
  }
}
