import { verifyMessage } from "ethers";

// EXACT mirror of src/crypto.ts canonicalize() — recursive key sort + JSON.stringify.
// The whole trust model depends on the client reconstructing the same bytes.
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}
function sortDeep(v: any): any {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

export interface AttestationRecord {
  model_id: string;
  worker_address: string | null;
  response_hash: string | null;
  canonical: string | null;
  signature: string | null;
  verified: boolean;
}
export interface Receipt {
  version: string;
  task_id: string;
  timestamp: number;
  input_hash: string;
  signals: { token_estimate: number; detected_lang: string; complexity_band: string };
  policy_hash: string;
  looper: string;
  candidates_considered: string[];
  chosen_model: string;
  response_hash: string;
  worker_attestations: AttestationRecord[];
  error?: boolean;
  image_digest?: string;
}
export interface Bundle {
  receipt: Receipt;
  canonical: string;
  signature: string;
  signer_address: string;
}

export interface SigCheck {
  label: string;
  role: "conductor" | "worker";
  expected: string;
  recovered: string;
  ok: boolean;
  model?: string;
}

/** Recover every signer in the receipt, entirely client-side. `receiptOverride`
 *  lets the tamper demo re-canonicalize a mutated receipt against the original
 *  signature — the recovered address then no longer matches. */
export function verifyChain(bundle: Bundle, receiptOverride?: Receipt): {
  checks: SigCheck[];
  receiptMatchesSigned: boolean;
  allOk: boolean;
} {
  const receipt = receiptOverride ?? bundle.receipt;
  const conductorCanonical = canonicalize(receipt);
  const receiptMatchesSigned = conductorCanonical === bundle.canonical;

  const checks: SigCheck[] = [];

  // 1. Conductor — recover from the (possibly re-canonicalized) receipt.
  const cRecovered = safeRecover(conductorCanonical, bundle.signature);
  checks.push({
    label: "Conductor receipt",
    role: "conductor",
    expected: bundle.signer_address,
    recovered: cRecovered,
    ok: cRecovered.toLowerCase() === bundle.signer_address.toLowerCase(),
  });

  // 2. Each worker — recover from its own embedded, signed canonical.
  for (const a of receipt.worker_attestations ?? []) {
    if (!a.canonical || !a.signature || !a.worker_address) {
      checks.push({ label: a.model_id, role: "worker", model: a.model_id, expected: "—", recovered: "unverified", ok: false });
      continue;
    }
    const r = safeRecover(a.canonical, a.signature);
    checks.push({
      label: "Worker inference",
      role: "worker",
      model: a.model_id,
      expected: a.worker_address,
      recovered: r,
      ok: r.toLowerCase() === a.worker_address.toLowerCase(),
    });
  }

  return { checks, receiptMatchesSigned, allOk: checks.every((c) => c.ok) };
}

function safeRecover(canonical: string, signature: string): string {
  try {
    return verifyMessage(canonical, signature);
  } catch {
    return "0xInvalidSignature";
  }
}

export const short = (a?: string | null) =>
  !a ? "—" : a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
