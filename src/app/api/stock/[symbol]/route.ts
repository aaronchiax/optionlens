import { NextResponse } from "next/server";
import { getStockSnapshot } from "@/lib/market-data/service";
import { badRequest, errorResponse, sourceParam, SYMBOL_RE } from "@/lib/market-data/http";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  if (!SYMBOL_RE.test(symbol)) return badRequest("Invalid symbol");
  try {
    return NextResponse.json(await getStockSnapshot(symbol.toUpperCase(), sourceParam(new URL(req.url))));
  } catch (e) {
    return errorResponse(e);
  }
}
