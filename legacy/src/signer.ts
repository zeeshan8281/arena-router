import type { HDNodeWallet } from "ethers";
import { walletFromPhrase, hash } from "./crypto.js";

let wallet: HDNodeWallet;

export function initSigner(): void {
  const phrase = process.env.MNEMONIC;
  if (!phrase) {
    throw new Error("MNEMONIC not present — not running in a provisioned enclave");
  }
  wallet = walletFromPhrase(phrase);
}

export function signerAddress(): string {
  return wallet.address;
}

export async function signReceipt(canonical: string): Promise<string> {
  // EIP-191 personal_sign — verifiable off-chain (ethers.verifyMessage) and on Etherscan.
  return wallet.signMessage(canonical);
}

export { hash };
