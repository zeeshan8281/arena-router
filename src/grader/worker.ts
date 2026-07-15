// Runs an untrusted participant policy under SES capability isolation.
// Inside the Compartment there is NO fetch / fs / process / require, so a
// policy cannot exfiltrate the hidden prompts it routes. Lives in its own
// worker thread so the parent can hard-kill a policy that hangs.
import "ses";
import { parentPort, workerData } from "node:worker_threads";

declare const lockdown: (opts?: unknown) => void;
declare const Compartment: new (endowments?: Record<string, unknown>) => { evaluate: (src: string) => unknown };

lockdown({ errorTaming: "unsafe", overrideTaming: "severe" });

interface Stage { kind: string; index: number; total: number }
interface PromptView { id: string; text: string; signals: Record<string, unknown>; stage?: Stage }
const { policyJs, prompts, models } = workerData as {
  policyJs: string;
  prompts: PromptView[];
  models: unknown[];
};

const out: Record<string, unknown> = {};
try {
  const compartment = new Compartment();
  // Evaluate the policy and return its decide function.
  const decide = compartment.evaluate(`${policyJs}\n;decide;`) as (p: PromptView, m: unknown[]) => unknown;
  if (typeof decide !== "function") throw new Error("policy does not define decide()");

  for (const p of prompts) {
    try {
      const view = { id: p.id, text: p.text, signals: p.signals, stage: p.stage };
      const d = decide(view, models) as { looper?: string; candidates?: string[] };
      // copy out only the fields we accept (plain data crosses the boundary)
      out[p.id] = d && Array.isArray(d.candidates)
        ? { looper: String(d.looper), candidates: d.candidates.map(String) }
        : null;
    } catch {
      out[p.id] = null;
    }
  }
  parentPort!.postMessage({ ok: true, decisions: out });
} catch (e) {
  parentPort!.postMessage({ ok: false, error: (e as Error).message });
}
