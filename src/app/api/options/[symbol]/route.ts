import { NextResponse } from "next/server";
import { getEnrichedChain } from "@/lib/market-data/service";
import { badRequest, DATE_RE, errorResponse, sourceParam, SYMBOL_RE } from "@/lib/market-data/http";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const url = new URL(req.url);
  const expiration = url.searchParams.get("expiration") ?? "";
  if (!SYMBOL_RE.test(symbol)) return badRequest("Invalid symbol");
  if (!DATE_RE.test(expiration)) return badRequest("expiration=YYYY-MM-DD required");
  try {
    return NextResponse.json(await getEnrichedChain(symbol.toUpperCase(), expiration, sourceParam(url)));
  } catch (e) {
    return errorResponse(e);
  }
}
