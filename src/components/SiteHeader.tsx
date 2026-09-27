"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import clsx from "clsx";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="rgb(var(--accent))" strokeWidth="2" />
        <path d="M5 15.5 L9.5 11 L13 13.5 L19 7" fill="none" stroke="rgb(var(--ink))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      OptionLens
    </span>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      aria-label="Toggle dark mode"
      className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface text-ink-2 transition hover:text-ink"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {mounted ? dark ? <Sun size={16} /> : <Moon size={16} /> : null}
    </button>
  );
}

export function SiteHeader() {
  const path = usePathname();
  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={clsx("rounded-lg px-3 py-1.5 text-sm transition", path.startsWith(href) && href !== "/" ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink")}
    >
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="OptionLens home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1">
          {link("/analyze", "Analyze")}
          {link("/dashboard", "Dashboard")}
          <div className="ml-2">
            <ThemeToggle />
          </div>
        </nav>
      </div>
    </header>
  );
}
