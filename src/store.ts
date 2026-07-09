import type { RoutingReceipt } from "./receipt.js";

export interface StoredReceipt {
  receipt: RoutingReceipt;
  canonical: string;
  signature: string;
  signer_address: string;
}

const CAP = 10_000;

// ponytail: in-memory ring buffer, cap 10k. v1 keeps the attestation surface
// small and the image deterministic. Persistence needs a sealed volume (v2).
class RingStore {
  private map = new Map<string, StoredReceipt>();

  put(id: string, value: StoredReceipt): void {
    this.map.set(id, value);
    if (this.map.size > CAP) {
      // Map preserves insertion order — evict oldest.
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  get(id: string): StoredReceipt | undefined {
    return this.map.get(id);
  }

  /** Last n receipts, newest first. */
  list(n: number): StoredReceipt[] {
    return Array.from(this.map.values()).slice(-n).reverse();
  }
}

export const store = new RingStore();
