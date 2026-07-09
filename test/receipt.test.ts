import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyMessage } from "ethers";

// A fixed mnemonic so the test is deterministic. NOT a real key.
process.env.MNEMONIC = "test test test test test test test test test test test junk";

const { initSigner, signerAddress, signReceipt } = await import("../src/signer.ts");
const { canonicalize } = await import("../src/receipt.ts");

initSigner();

test("canonical form is byte-stable regardless of key insertion order", () => {
  const a = canonicalize({ b: 1, a: 2, nested: { y: 1, x: 2 } });
  const b = canonicalize({ nested: { x: 2, y: 1 }, a: 2, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":2,"b":1,"nested":{"x":2,"y":1}}');
});

test("canonicalize -> sign -> verifyMessage recovers the signer address", async () => {
  const canonical = canonicalize({
    version: "1",
    task_id: "fixed-id",
    chosen_model: "openai/gpt-4o",
    signals: { complexity_band: "low", detected_lang: "en", token_estimate: 3 },
  });
  const sig = await signReceipt(canonical);
  assert.equal(verifyMessage(canonical, sig), signerAddress());
});
