// Builds the GitHub Pages edition into ./out (see next.config.mjs, STATIC_EXPORT).
// Requires public/data (from market-data-service/snapshot.py).
//
// API route handlers can't be statically exported, so the build runs in a temporary copy of
// the project without src/app/api. The working tree is never modified.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, sep } from "node:path";

const root = process.cwd();
if (!existsSync(join(root, "public", "data", "index.json"))) {
  console.error("public/data/index.json missing — run: python market-data-service/snapshot.py public/data");
  process.exit(1);
}

const SKIP = new Set(["node_modules", ".next", ".next-static", "out", ".git", ".venv", "__pycache__"]);
const work = join(mkdtempSync(join(tmpdir(), "optionlens-pages-")), "optionlens");
cpSync(root, work, {
  recursive: true,
  filter: (src) => {
    const rel = relative(root, src);
    if (!rel) return true;
    if (rel.split(sep).some((p) => SKIP.has(p))) return false;
    return rel !== join("src", "app", "api");
  },
});
symlinkSync(join(root, "node_modules"), join(work, "node_modules"), "junction");

const r = spawnSync("npx next build", {
  cwd: work,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, STATIC_EXPORT: "1", NEXT_PUBLIC_STATIC_DATA: "1" },
});
if (r.status === 0) {
  rmSync(join(root, "out"), { recursive: true, force: true });
  cpSync(join(work, "out"), join(root, "out"), { recursive: true });
  console.log(`\nStatic site written to ./out (built in ${basename(work)})`);
}
rmSync(join(work, ".."), { recursive: true, force: true });
process.exit(r.status ?? 1);
