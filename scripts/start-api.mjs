// Starts the Python yfinance market-data service, preferring the local venv.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "market-data-service");
const candidates = [
  join(dir, ".venv", "Scripts", "python.exe"),
  join(dir, ".venv", "bin", "python"),
];
const python = candidates.find(existsSync) ?? (process.platform === "win32" ? "python" : "python3");
const port = process.env.MARKET_DATA_PORT ?? "8765";

const child = spawn(python, ["-m", "uvicorn", "main:app", "--port", port], { cwd: dir, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
