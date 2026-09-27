import { NextResponse } from "next/server";
import { MarketDataError } from "./types";

export const SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,15}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function sourceParam(url: URL): string | null {
  return url.searchParams.get("source") === "simulated" ? "simulated" : null;
}

export function errorResponse(e: unknown) {
  if (e instanceof MarketDataError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(e);
  return NextResponse.json({ error: "Unexpected error retrieving market data." }, { status: 500 });
}

export function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}
