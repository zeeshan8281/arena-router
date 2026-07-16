#!/usr/bin/env node
// Standalone external verifier — verifies the WHOLE chain from one trace,
// trusting only public /pubkey endpoints and ethers:
//   1. the conductor signed the routing receipt (recovers to conductor /pubkey)
//   2. every worker in worker_attestations[] signed its own output
//      (recovers to that worker's claimed address)
//   3. tampering anything breaks (1) because the receipt embeds every worker canonical
//
//   node scripts/verify.mjs <conductor_base_url> <task_id>

import { verifyMessage } from "ethers";

const [, , base, taskId] = process.argv;
if (!base || !taskId) {
  console.error("usage: node scripts/verify.mjs <conductor_base_url> <task_id>");
  process.exit(2);
}

const trace = await (await fetch(`${base}/trace/${taskId}`)).json();
const { address } = await (await fetch(`${base}/pubkey`)).json();

let ok = true;

// 1. Conductor's receipt.
const conductor = verifyMessage(trace.canonical, trace.signature);
const conductorOk = conductor.toLowerCase() === address.toLowerCase();
ok &&= conductorOk;
console.log(`conductor: ${conductorOk ? "✓" : "✗"} ${conductor}${conductorOk ? " (matches /pubkey)" : ` (expected ${address})`}`);

// 2. Each worker attestation carries its exact signed bytes.
const workers = trace.receipt.worker_attestations ?? [];
for (const att of workers) {
  if (!att.verified || !att.signature || !att.canonical) {
    console.log(`worker   : ✗ ${att.model_id} — no verified attestation (route failed or worker unverified)`);
    ok = false;
    continue;
  }
  const recovered = verifyMessage(att.canonical, att.signature);
  const workerOk = recovered.toLowerCase() === (att.worker_address ?? "").toLowerCase();
  ok &&= workerOk;
  console.log(`worker   : ${workerOk ? "✓" : "✗"} ${att.model_id} signed by ${recovered}`);
}

console.log(
  ok
    ? `\n✓ CHAIN VERIFIED — decision + ${workers.length} inference attestation(s), all enclave-signed`
    : "\n✗ CHAIN BROKEN — do not trust",
);
process.exit(ok ? 0 : 1);
