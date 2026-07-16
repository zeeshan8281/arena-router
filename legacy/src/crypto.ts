import { keccak256, toUtf8Bytes, Wallet, type HDNodeWallet } from "ethers";

/** keccak256 over the UTF-8 bytes of a string. */
export function hash(s: string): string {
  return keccak256(toUtf8Bytes(s));
}

/**
 * Deterministic serialization: keys sorted recursively, so the byte form is
 * reproducible and any signature over it is independently verifiable. Never
 * rely on JSON.stringify insertion order for objects we didn't build.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Enclave-bound wallet from a KMS-injected mnemonic (path m/44'/60'/0'/0/0). */
export function walletFromPhrase(phrase: string): HDNodeWallet {
  return Wallet.fromPhrase(phrase);
}
