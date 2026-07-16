import { config } from "../config.js";
import type { Signals } from "./signals.js";

export interface Decision {
  looper: "single" | "confidence" | "ratings" | "remom";
  candidates: string[];
}

/**
 * Pure function of signals + the active recipe. The recipe is public
 * (ROUTING_RECIPE_PUBLIC) and hashed into every receipt as policy_hash, so
 * this decision is independently checkable.
 */
export function decide(signals: Signals): Decision {
  const band = config().recipe.bands[signals.complexity_band];
  return { looper: band.looper, candidates: band.models };
}
