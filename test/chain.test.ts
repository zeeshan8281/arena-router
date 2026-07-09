import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyMessage } from "ethers";
import { canonicalize, hash, walletFromPhrase } from "../src/crypto.ts";
import type { WorkerAttestation } from "../src/attestation.ts";

// A worker signs with its OWN enclave key, distinct from the conductor's.
const worker = walletFromPhrase("legal winner thank year wave sausage worth useful legal winner thank yellow");

function makeSigned(modelId: string, content: string) {
  const attestation: WorkerAttestation = {
    version: "1",
    model_id: modelId,
    input_hash: hash("payload"),
    response_hash: hash(content),
    timestamp: 1,
    worker_address: worker.address,
  };
  const canonical = canonicalize(attestation);
  return { attestation, canonical, content };
}

// Mirrors exactly the checks callWorker() runs conductor-side.
function conductorVerifies(bundle: { attestation: WorkerAttestation; canonical: string; content: string }, signature: string, expectedModel: string) {
  const a = bundle.attestation;
  return (
    canonicalize(a) === bundle.canonical &&
    verifyMessage(bundle.canonical, signature).toLowerCase() === a.worker_address.toLowerCase() &&
    hash(bundle.content) === a.response_hash &&
    a.model_id === expectedModel
  );
}

test("conductor accepts a genuine worker attestation", async () => {
  const b = makeSigned("openai/gpt-4o", "the answer");
  const sig = await worker.signMessage(b.canonical);
  assert.equal(conductorVerifies(b, sig, "openai/gpt-4o"), true);
});

test("tampering the worker's content breaks response_hash", async () => {
  const b = makeSigned("openai/gpt-4o", "the answer");
  const sig = await worker.signMessage(b.canonical);
  const tampered = { ...b, content: "a different answer" };
  assert.equal(conductorVerifies(tampered, sig, "openai/gpt-4o"), false);
});

test("a worker swapping in a different model_id is rejected", async () => {
  const b = makeSigned("openai/gpt-4o-mini", "cheap answer"); // signed as mini
  const sig = await worker.signMessage(b.canonical);
  assert.equal(conductorVerifies(b, sig, "openai/gpt-4o"), false); // but conductor asked for gpt-4o
});

test("a forged signature does not recover to the claimed worker", async () => {
  const b = makeSigned("openai/gpt-4o", "the answer");
  const other = walletFromPhrase("test test test test test test test test test test test junk");
  const forged = await other.signMessage(b.canonical);
  assert.equal(conductorVerifies(b, forged, "openai/gpt-4o"), false);
});
