import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyMessage } from "ethers";

process.env.MNEMONIC = "test test test test test test test test test test test junk";

const { initSigner, signerAddress, signReceipt } = await import("../src/signer.ts");
const { canonicalize } = await import("../src/receipt.ts");

initSigner();

// Simulates an external verifier holding only { canonical, signature, expected_address }.
test("external verifier recovers the expected address", async () => {
  const canonical = canonicalize({ task_id: "x", chosen_model: "openai/gpt-4o" });
  const signature = await signReceipt(canonical);
  const expected = signerAddress();
  assert.equal(verifyMessage(canonical, signature), expected);
});

test("tampering any field breaks verification", async () => {
  const canonical = canonicalize({ task_id: "x", chosen_model: "openai/gpt-4o" });
  const signature = await signReceipt(canonical);
  const expected = signerAddress();

  // Flip one character in the canonical string a verifier reconstructs.
  const tampered = canonical.replace("gpt-4o", "gpt-5o");
  assert.notEqual(verifyMessage(tampered, signature), expected);
});
