import { canonicalize, hash } from "./crypto.js";
import { signReceipt, signerAddress } from "./signer.js";
import { store, type StoredReceipt } from "./store.js";
import type { AttestationRecord } from "./attestation.js";

export interface RoutingReceipt {
  version: "1";
  task_id: string;          // uuid v4, also the /trace/:id key
  timestamp: number;        // ms epoch, set inside the conductor enclave
  input_hash: string;       // keccak256 of the raw request body (NOT the plaintext)
  signals: {
    token_estimate: number;
    detected_lang: string;
    complexity_band: "low" | "med" | "high";
  };
  policy_hash: string;      // keccak256 of the active policy (recipe + params)
  looper: "single" | "confidence" | "ratings" | "remom";
  candidates_considered: string[];
  chosen_model: string;
  response_hash: string;    // keccak256 of the final chosen response text
  // Each entry is a worker's own signed proof that it served that model_id and
  // produced that output. This is what closes the chain past the decision.
  worker_attestations: AttestationRecord[];
  error?: boolean;          // a failed / unverified route is still an auditable decision
  image_digest?: string;    // the conductor's own RTMR digest, if surfaced
}

/** Build canonical form, sign with the conductor key, store. */
export async function buildAndStore(receipt: RoutingReceipt): Promise<StoredReceipt> {
  const canonical = canonicalize(receipt);
  const signature = await signReceipt(canonical);
  const bundle: StoredReceipt = {
    receipt,
    canonical,
    signature,
    signer_address: signerAddress(),
  };
  store.put(receipt.task_id, bundle);
  return bundle;
}

export { canonicalize, hash };
