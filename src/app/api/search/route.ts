import { NextResponse } from "next/server";
import { getProvider } from "@/lib/market-data";
import { badRequest, errorResponse, sourceParam } from "@/lib/market-data/http";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q || q.length > 40) return badRequest("Query required");
  try {
    const r = await getProvider(sourceParam(url)).search(q);
    return NextResponse.json({ results: r.data, meta: r.meta });
  } catch (e) {
    return errorResponse(e);
  }
}
