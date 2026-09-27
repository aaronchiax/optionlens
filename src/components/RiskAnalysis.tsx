import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import clsx from "clsx";
import type { RiskItem } from "@/lib/engine/types";

const LEVEL = {
  high: { icon: ShieldAlert, cls: "text-loss", label: "Elevated" },
  medium: { icon: AlertTriangle, cls: "text-warn", label: "Moderate" },
  low: { icon: CheckCircle2, cls: "text-gain", label: "Lower" },
  info: { icon: Info, cls: "text-ink-2", label: "" },
} as const;

export function RiskAnalysis({ risks }: { risks: RiskItem[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {risks.map((r) => {
        const L = LEVEL[r.level];
        return (
          <div key={r.key} className="rounded-xl border border-line p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <L.icon size={16} className={L.cls} aria-hidden />
                <h4 className="text-sm font-semibold">{r.title}</h4>
              </div>
              <div className="text-right">
                {r.value && <div className="text-sm font-semibold tnum">{r.value}</div>}
                {L.label && <div className={clsx("text-[10px] font-semibold uppercase tracking-wide", L.cls)}>{L.label} risk</div>}
              </div>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{r.text}</p>
          </div>
        );
      })}
    </div>
  );
}
