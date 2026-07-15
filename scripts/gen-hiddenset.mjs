#!/usr/bin/env node
// Generate the arena HIDDEN set. Tasks + rubrics are authored here; `signals`
// are COMPUTED from the text (same band rules as src/router/signals.ts) so they
// stay honest and the file is regenerable. Difficulty spans easy→hard, and a few
// tasks deliberately DIVERGE: surface signals look easy while the task is hard
// (short trick prompts) — that's where routing skill is rewarded.
//
//   node scripts/gen-hiddenset.mjs      → writes arena/hidden/hiddenset.json (gitignored)
//   HIDDEN_SET_B64 = base64 of that file's contents (printed at the end)
import { mkdirSync, writeFileSync } from "node:fs";

// difficulty is a note for us (NOT shown to policies) — documents intended spread.
const TASKS = [
  { id: "t01", difficulty: "easy",
    text: "Name the capital city of Australia. Reply with only the city name.",
    rubric: "Full credit ONLY if the answer is 'Canberra'. Sydney or Melbourne (the common trap) = 0. Any other city = 0." },

  { id: "t03", difficulty: "easy",
    text: "In one sentence, what does the HTTP status code 404 mean?",
    rubric: "Full credit if it conveys the resource/page was not found on the server. 0.5 if vague ('an error'). 0 if it gives the wrong meaning (e.g. server error, unauthorized)." },

  { id: "t06", difficulty: "medium",
    text: "Translate into formal (keigo) Japanese and then briefly explain the politeness level in English. Sentence: 'Could you please send me the report by tomorrow?'",
    rubric: "Full credit if the translation uses formal keigo (e.g. お送りいただけますでしょうか / 〜していただけますか) AND the explanation correctly identifies it as formal/polite (keigo/teineigo). 0.5 if the translation is correct but the explanation is missing or wrong. 0 if it uses plain/casual form or mistranslates." },

  { id: "t07", difficulty: "hard",
    text: "A tank fills via pipe A in 6 hours and via pipe B in 4 hours; pipe C drains a full tank in 3 hours. Starting from empty with all three open, how long until the tank is exactly half full? Give the answer in hours and show the rate equation.",
    rubric: "Net rate = 1/6 + 1/4 − 1/3 = 1/12 tank per hour; half full at t = (1/2)/(1/12) = 6 hours. Full credit for 6 hours WITH the rate equation shown. 0.5 if the number is right but no equation, or the right method with an arithmetic slip. 0 otherwise." },

  { id: "t08", difficulty: "hard",
    text: "Implement an LRU cache class in Python supporting get(key) and put(key, value), both O(1) average time. Then explain which data structures make each operation O(1) and why. Return the code first, then the explanation.",
    rubric: "Full credit requires all three: (1) a correct O(1) LRU using a hashmap + doubly-linked list, or OrderedDict with move_to_end/popitem(last=False); (2) correct eviction of the least-recently-used entry on capacity overflow; (3) an explanation naming the hashmap for O(1) lookup and the linked-list/OrderedDict for O(1) recency updates. Deduct 0.34 per missing item. 0 if get/put are O(n) or eviction is incorrect." },

  // ── DIVERGENCE: short, no code, no '?' → will band LOW, but genuinely hard. ──
  { id: "t09", difficulty: "hard",
    text: "Prove that the square root of 2 is irrational, then explain precisely why the same proof fails for the square root of 4.",
    rubric: "Full credit requires (1) a valid proof by contradiction: assume √2 = a/b in lowest terms, show a is even, then b is even, contradicting lowest terms; and (2) a correct explanation that the argument fails for 4 because 4 is a perfect square, so √4 = 2 = 2/1 is rational and no contradiction arises. 0.5 if the proof is correct but the 'why it fails for 4' part is missing or hand-wavy. 0 if the proof is invalid." },
];

// ── signal extraction — mirrors src/router/signals.ts band logic ──
function signals(text) {
  const token_estimate = Math.ceil(text.length / 4);
  const questions = (text.match(/\?/g) || []).length;
  const has_code = /```/.test(text) || /\b(function|class|def|import|SELECT)\b/.test(text);
  let complexity_band;
  if (has_code || token_estimate > 400 || questions >= 3) complexity_band = "high";
  else if (token_estimate > 120 || questions >= 1) complexity_band = "med";
  else complexity_band = "low";
  return { token_estimate, detected_lang: "en", complexity_band, has_code };
}

const prompts = TASKS.map((t) => ({ id: t.id, text: t.text, signals: signals(t.text), rubric: t.rubric }));

mkdirSync("arena/hidden", { recursive: true });
const json = JSON.stringify({ prompts }, null, 2);
writeFileSync("arena/hidden/hiddenset.json", json);

// quick spread report so we can eyeball surface-band vs intended difficulty
console.log("wrote arena/hidden/hiddenset.json —", prompts.length, "tasks\n");
console.log("id   difficulty  band   tokens  code");
for (const t of TASKS) {
  const s = signals(t.text);
  const flag = bandRank(s.complexity_band) < diffRank(t.difficulty) ? "  ← DIVERGENCE (looks easier than it is)" : "";
  console.log(`${t.id}  ${t.difficulty.padEnd(10)} ${s.complexity_band.padEnd(6)} ${String(s.token_estimate).padEnd(7)} ${s.has_code}${flag}`);
}
function bandRank(b) { return { low: 0, med: 1, high: 2 }[b]; }
function diffRank(d) { return { easy: 0, medium: 1, hard: 2 }[d]; }

console.log("\nHIDDEN_SET_B64 (set this in the enclave):\n");
console.log(Buffer.from(json).toString("base64"));
