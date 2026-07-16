// Shared trust contracts between conductor and workers.

/** What a worker signs with its OWN enclave-bound key over each inference. */
export interface WorkerAttestation {
  version: "1";
  model_id: string;
  input_hash: string;      // keccak256 of the exact payload the worker received
  response_hash: string;   // keccak256 of the output it produced
  timestamp: number;       // ms epoch, set inside the worker enclave
  worker_address: string;  // the worker's signer address (also recoverable from the signature)
  image_digest?: string;   // the worker's own RTMR-measured digest, if surfaced
}

/** The worker's HTTP response to POST /infer. */
export interface WorkerResponse {
  content: string;
  attestation: WorkerAttestation;
  canonical: string;       // canonicalize(attestation) — the exact signed bytes
  signature: string;       // EIP-191 signature by worker_address
  metrics?: { avg_logprob: number | null }; // advisory routing signal, not signed
}

/** What the conductor folds into the routing receipt after verifying a worker.
 *  Carries the worker's EXACT signed bytes (canonical) + signature so any
 *  downstream party can independently recover the worker_address — the
 *  conductor's own signature over the receipt then binds these in place. */
export interface AttestationRecord {
  model_id: string;
  worker_address: string | null;
  response_hash: string | null;
  image_digest?: string;
  canonical: string | null;  // the worker's signed WorkerAttestation, canonicalized
  signature: string | null;
  verified: boolean;         // conductor re-checked signature + hashes + model_id
}
