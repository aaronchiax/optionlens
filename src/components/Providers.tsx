"use client";

import { ThemeProvider } from "next-themes";
import { DisclaimerProvider } from "./Disclaimer";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <DisclaimerProvider>{children}</DisclaimerProvider>
    </ThemeProvider>
  );
}
