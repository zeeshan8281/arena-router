import { Worker } from "node:worker_threads";
import ts from "typescript";
import type { Decision } from "./score.js";

/** Strip TypeScript types and any runtime imports; unwrap `export`. Participant
 *  policies may only `import type` (removed) — no runtime deps in the sandbox. */
export function transpile(src: string): string {
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, isolatedModules: true },
  }).outputText;
  return js
    .replace(/^\s*import\s.*$/gm, "")            // drop any leftover imports
    .replace(/\bexport\s+(function|const|let|var|default)\b/g, "$1");
}

export interface SandboxResult {
  ok: boolean;
  decisions?: Record<string, Decision | null>;
  error?: string;
}

/** Run the policy over all prompts in an isolated worker with a wall-clock cap. */
export function runPolicy(
  policyJs: string,
  prompts: { id: string; text: string; signals: Record<string, unknown>; stage?: { kind: string; index: number; total: number } }[],
  models: unknown[],
  timeoutMs = 5000,
): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      workerData: { policyJs, prompts, models },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: "policy timed out" });
    }, timeoutMs);

    worker.once("message", (msg: SandboxResult) => { clearTimeout(timer); worker.terminate(); resolve(msg); });
    worker.once("error", (err) => { clearTimeout(timer); worker.terminate(); resolve({ ok: false, error: err.message }); });
  });
}
