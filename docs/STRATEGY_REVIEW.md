# AutoRouter Arena — Strategy & Evaluation Review

*Discussion doc for the strategy meeting. Mixes plain-language framing with the technical
detail behind each point. Prepared from two adversarial code reviews of the current repo
(git HEAD `34df512`), including numbers verified against the live grader's own scoring code.*

---

## TL;DR — what to decide in this meeting

The competition asks a good question: **"write a routing policy that gets good answers cheaply."**
The recent rearchitecture (live inference + LLM judge, GitHub identity) fixed the two worst
problems from the prior design. But the new design introduced a different failure: **the
leaderboard currently can't reliably tell a better routing policy from a worse one, and in one
case it rewards not routing at all.**

Three decisions worth leaving the room with:

1. **Does the leaderboard rank skill or luck?** Today it ranks the luckiest re-submission. (§2.1)
2. **Does the score reward routing?** Today, on expensive tasks, "return nothing" can outscore a good answer. (§2.2)
3. **What is this benchmark's honest claim?** The docs promise verifiability the code doesn't deliver. Pick a lane and align. (§2.3)

Everything below expands these with evidence and concrete options.

---

## 1. Where we are (the good news first)

**Plain version.** The competition used to have a fatal cheat: answers were stored in a lookup
table that anyone could read back and copy, so a perfect score was trivial. That's gone. Grading
now actually runs the models live and has a judge score the result, so there's nothing static to
steal. Identity is now tied to a verified GitHub login, so people can't impersonate each other.
The set of models to choose from is richer, so model choice genuinely matters now.

**Technical version.**
- Grading moved from a static `outcomes[chosen].quality` table lookup to **live multi-stage
  inference**: `decide()` routes each stage, the chosen model runs on the stage prompt with prior
  output chained as context, and an LLM judge scores the final transcript against a hidden rubric
  (`src/grader/score.ts`, `src/grader/infer.ts`).
- This **closes the original critical exploit** (hidden-set exfiltration → oracle) at the root:
  there is no answer table to reconstruct.
- Identity spoofing is closed: leaderboard name = verified `gh:<login>`, resolved server-side from
  the token (`src/grader/index.ts:106-119`).
- The catalog grew to 5 open models spanning a 10× price range ($0.002–$0.020), and the cost
  penalty `λ` was raised to 8.0 — model choice now has large score consequences.

**We verified the old "skill ceiling" complaint is resolved.** Previously the gap between a
mindless constant policy and a perfect one was ~0.34% — the reward surface was flat, so skill
couldn't separate anyone. On the current config that band is ~26× wider (oracle 0.673 vs
always-cheapest 0.580; always-strongest is a *disaster* at 0.430 because heavy models are now
heavily penalized). The surface is no longer flat. **That specific problem is fixed.**

---

## 2. The three issues that should drive the meeting

### 2.1 The leaderboard measures luck and persistence, not routing skill

**Plain version.** Grading is random each time you run it (the judge and the models aren't pinned
to be deterministic). The leaderboard keeps your *best* score across all your submissions, and
there's no limit on how many times you can submit. So the winning move is to submit the same policy
over and over and keep whichever run got lucky. A patient person with a mediocre policy beats a
one-shot submission of a better policy. This directly contradicts our "un-gameable leaderboard" pitch.

**Technical version.**
- Scoring is non-deterministic: neither the routed model calls nor the judge set `temperature`/`seed`
  (`infer.ts:40,78`), so both run at the provider's default (nonzero) temperature.
- The leaderboard keeps `max(score)` per participant (`index.ts:183`); there is no rate limit and no
  per-participant submission cap. Re-submitting your own identical policy is allowed.
- With only **N=3 hidden tasks** and a judge that returns credit in coarse 0.25 steps, one rubric
  item flipping shifts `mean_quality` by ~0.083 — while the skill gap between two *good* policies is
  only ~0.02. **Grading noise is ~4–5× the skill signal.**
- Net: `E[max of K noisy draws]` grows with K. The leaderboard rewards whoever submits most.

**Options to discuss.**
- Pin `temperature=0` (and seed where supported) on both routed calls and the judge.
- Rank by the **mean over K graded runs**, not best-of-N; sign over the mean.
- Add a per-participant submission cap / cooldown, and dedup identical `policy_hash` resubmissions.
- Grow the hidden set well beyond 3 tasks so the noise floor drops below the skill band.

### 2.2 The metric can reward *not routing* (verified against the live scorer)

**Plain version.** Because expensive routing choices are penalized so hard, there are situations
where deliberately returning an invalid/empty answer (which scores zero) beats returning a genuinely
good answer (which can score *below* zero once its cost is subtracted). A benchmark about routing
where "refuse to route" can win is pointing the wrong way. Separately, two of the four "loopers"
(strategies that call several models) are mathematically not worth using except in narrow cheap cases.

**Technical version.** `score = mean_quality − 8·mean_cost` (the openness term is inert, β=0). We
wrote a test that drives the **real** `score()` with a controlled judge (`test/scoring-flaws.test.ts`,
deterministic, no network) and confirmed:

| Claim | Result |
|---|---|
| Full 5-model `ratings` over a 3-stage task, judge gives perfect **1.0** | scores **−0.104** (cost 0.138 × λ8) |
| An **invalid** decision (quality 0, cost 0, still counted in N) | scores **0.000 → beats the perfect-but-expensive route** |
| Tipping line for a 3× `llama-3.3-70b` route (penalty 0.48) | loses to "nothing" at q=0.47, wins at q=0.49 → any route with `quality < λ·cost` loses to failing |
| *Cheap* 2-model `ratings` (Δcost 0.004, threshold 0.032) | **beats** single at +0.05 quality lift, loses at +0.01 |

So: **Flaw #1** — invalid-scores-0-but-counts-in-N creates a perverse floor where failing outranks a
net-negative answer. **Flaw #2** — at λ=8, *expensive* fan-out (`ratings`/`remom` over many/costly
models) is dominated for any achievable quality; it stays rational only for narrow, cheap candidate
sets. (The nuance matters: the loopers aren't dead, they're dead *at scale*.)

**Options to discuss.**
- Floor each task's contribution at 0 (or make invalid a large negative) so failing never beats answering.
- Re-examine λ=8 against the looper design: if we want fan-out strategies to be live options, λ or the
  cost model has to leave room for them.
- Decide whether `remom`/`ratings` should exist as advertised strategies given they're only rational
  in a narrow band; either widen that band or trim the menu.

### 2.3 The docs promise verifiability the implementation doesn't provide

**Plain version.** Our whole pitch is "trustworthy, verifiable, un-gameable." But the spec describes
a system we didn't build: it claims an attested worker fleet where every model call is independently
proven, and it claims anyone can re-run and audit a score. Neither is true — the grader just calls a
third-party API (OpenRouter) directly, and because grading is random, re-running gives a different
number. For a benchmark whose product *is* trust, saying we verify things we don't is itself a
credibility problem, separate from any code bug.

**Technical version.**
- COMPETITION.md §7 claims "each inference carries its worker's own attestation
  (`worker_attestations_root`)". No such field exists; the grader makes plain HTTPS calls to
  OpenRouter (`infer.ts:22-67`). Which model actually served each token is unverifiable.
- §2/§6 claim "same policy → reproducible score" and "recomputed and audited end to end." Live
  non-deterministic grading means re-running yields a different `results_root`. `score.ts`'s own
  header admits it's "trustworthy because attested, not because you can re-run it."
- The sandbox is named `isolated-vm` in four places; it's actually SES `lockdown()`+Compartment in a
  worker thread, with a single 5s wall-clock over all stages (not a per-call CPU limit).
- Smaller drifts that mislead entrants: doc says `λ=4.0`, catalog is `8.0` (a 2× error on the single
  knob that defines the game); example model ids in the docs (`gpt-oss-20b`, `nemotron-nano-9b`)
  aren't in the catalog and would score 0 if copied; §8 lists already-built components as unbuilt TODOs.

**Options to discuss.**
- Pick the honest claim and align the docs: *either* "only the aggregate score is attested; individual
  model provenance and reproducibility are not" *or* invest in making it actually reproducible
  (deterministic grading + stored transcripts) and actually attested per-inference.
- This is a **strategy** decision, not a copy-edit: it determines what the benchmark is allowed to claim.

---

## 3. The deeper strategic question: what is this benchmark measuring?

**Plain version.** Even with every bug fixed, we should ask whether the score reflects something real.
Right now "cost" is a flat price per call — it ignores how many tokens a request uses, how slow it is,
whether it hits a rate limit, or whether the input even fits the model. Real routing decisions are
driven by exactly those things. So the benchmark measures a *stylized* version of routing. That can be
fine — but only if we say so, and only if the tasks are rich enough to reward real skill.

**Technical version / open questions for the room.**
- **Cost fidelity.** `price_per_call` is a flat scalar; per-token cost, latency, throughput, and rate
  limits are unmodeled, and the `context` window field is never enforced (`score.ts` reads it nowhere).
  A long transcript routed to a 32k model just errors and tanks quality — an infra outcome, not a
  routing verdict. Do we want realism (add deterministic per-token cost, latency, context enforcement)
  or do we keep it stylized and scope the claim honestly?
- **Signal quality.** N=3 tasks, single judge, coarse rubric. Is the task set representative of the
  routing decisions we care about? What's the target N and judge protocol?
- **Infra vs. routing.** Today a transient API failure is charged to the policy on both cost and
  quality (`score.ts:135`, errored calls still counted). Should infra failures be excluded/retried so
  the score reflects routing choices, not provider weather?
- **Determinism vs. realism tension.** Some omissions (latency, live variance) are *forced* by wanting
  an attestable, signable receipt — you can't sign a non-deterministic latency number. That tension is
  real and worth an explicit decision: how much realism are we willing to trade for verifiability?

---

## 4. How we compare to existing routing benchmarks

**Plain version.** Routing is already a real benchmark niche — there are ~10 published ones. The
important finding: **almost all of them are static lookup tables** (pre-run every model on every
question once, then let a "router" pick from stored answers). That design is exactly what made our
*old* arena cheatable — a readable answer table is an oracle. Our move to **live inference** puts us
in a small, more defensible group (only one academic arena and the closed commercial routers run
live). So the rearchitecture isn't just a bug fix; it's a genuine differentiator. The flip side: the
static crowd got determinism and reproducibility *for free* by freezing everything once, and by going
live we took on exactly the two problems in §2.1 and §2.2 that they defined away.

**Technical version.**

| Benchmark | Who / year | Routing shape | Static table or live | Headline metric |
|---|---|---|---|---|
| **RouterBench** | Martian, 2024 | pick-one + cascade, predictive | **Static** (405k precomputed outcomes, 11 models) | **AIQ** — area under cost-quality convex hull |
| **RouteLLM** | LMSYS / Berkeley, 2024 | binary strong-vs-weak, predictive | **Static** (Arena battles + one-time GPT-4 judge labels) | **APGR** — ∫ performance-gap-recovered; CPT(x%) |
| **Hybrid LLM** | Microsoft, ICLR 2024 | small-vs-large, predictive | trained on labels | % large-model calls at fixed quality |
| **FrugalGPT** | Stanford, 2023 | **cascade** (the origin), post-hoc | offline | % cost cut matching GPT-4 |
| **ZOOTER** | Alibaba, 2023 | pick-one, predictive | offline | reward-guided routing accuracy |
| **MixLLM** | NAACL 2025 | pick-one, contextual bandit | online-capable | quality + cost + **latency** objective |
| **OptLLM** | ICWS 2024 | pick-one, predictive | offline | Pareto frontier (cost vs accuracy) |
| **RouterEval** | 2025 | pick-one eval | **Static** (200M records, 8,500 models) | model-level scaling curve |
| **RouterArena** | RouteWorks, 2025 | pick-one | **live leaderboard** | area-under-tradeoff |
| Not Diamond / Martian / Unify | commercial | pick-one | proprietary, no public suite | — |

Three takeaways that bear directly on our decisions:

- **The field reports a *curve*; we report a single point.** RouterBench's **AIQ** (area under the
  non-decreasing cost-quality convex hull, normalized by cost range) and RouteLLM's **APGR** (integral
  of the performance-gap-recovered curve from weak to strong) both *sweep the cost budget and
  integrate*. Our `mean_quality − λ·mean_cost` is a single-point scalarization at one fixed λ — **one
  λ choice decides the winner** (reinforces §2.2). Adopting an AIQ-style area metric would also
  *dissolve* the "not-routing beats routing" inversion: the convex-hull normalization anchors the
  low-cost end so a net-negative point can't fall below "return nothing."
- **Static tables are oracle-leakable by construction** — which is exactly our old
  hidden-set-exfiltration exploit. Going live is the structural fix the academic mainstream *hasn't*
  taken; it's a marketable differentiator, provided we don't re-expose outcomes via a submission
  endpoint (see the still-open `/submission/:id` leak).
- **Judge variance is the shared weak spot, and the table benchmarks cheat around it in a way we
  can't.** RouteLLM/RouterBench freeze judge labels *once* (deterministic but unrealistic). We run the
  judge live per submission, so we face the variance head-on (that's §2.1). The standard LLM-judge
  mitigations we can lift directly: pin judge model + `temperature=0` per season, average multiple
  judge samples, position-swap to kill order bias, calibrate against a small gold set.

**One-line framing for the room:** we're building a *live* router benchmark in a field that's ~90%
static tables. That's the right bet — it's what makes us contamination- and oracle-resistant — but it
means §2.1 and §2.2 are the price of live realism, and we've departed from the field's convention of
reporting a cost-quality *area* (AIQ/APGR) rather than a single-λ score. Those two metrics are the
references to hold our scoring formula up against.

*(Note: MixInstruct/LLM-Blender is a fusion system, not a router — it runs all models to raise
quality, the opposite of cost-saving — so it's excluded above despite often appearing in routing
lit reviews.)*

---

## 5. Suggested priority order (for sequencing the work, not prescribing it)

| Priority | Theme | Why first | Rough lift |
|---|---|---|---|
| P0 | Deterministic grading + rank-by-mean + submission cap (§2.1) | Without this the leaderboard is noise; everything else is downstream of a trustworthy ranking | Low–medium (config + scoring loop) |
| P0 | Floor per-task contribution / fix invalid-beats-valid (§2.2) | It's an outright inversion, verified, and a one-line-ish scoring change | Low |
| P1 | Doc-vs-reality alignment / pick the honest claim (§2.3) | Credibility of the whole product; also unblocks what we can market | Low (writing) + strategy decision |
| P1 | Grow hidden set; harden judge (§2.1, §3) | Raises signal above noise | Medium (content + judge protocol) |
| P2 | Cost-model fidelity: per-token / latency / context (§3) | Turns a stylized score into a defensible real-utility proxy | Medium–high, needs design |
| P2 | Looper economics: retune λ or trim the menu (§2.2) | Makes the advertised strategy space real | Medium, entangled with cost model |

---

## 6. What's already verified vs. still open (so we argue about the right things)

**Verified against code/arithmetic this review (don't re-litigate):**
- Invalid-beats-valid inversion and expensive-fan-out dominance — proven against the real `score()`
  (`test/scoring-flaws.test.ts`).
- Non-determinism + best-of-N + no cap — confirmed in `index.ts`/`infer.ts`.
- Doc/impl mismatches (attestation, reproducibility, isolated-vm, λ, model ids) — confirmed by file.
- The old flat-reward-surface / 0.34% ceiling is fixed — recomputed on current config.

**Refuted (raised but knocked down — don't spend meeting time here):**
- Sandbox key exfiltration, worker OOM crashing the grader, λ=8 "collapsing" the surface, mistral
  Pareto-domination, remom being strictly dominated live. All investigated and dismissed.

**Genuinely open — needs empirical runs to settle (candidate for a follow-up spike):**
- How much does the LLM judge actually vary run-to-run on the real 3 tasks? (Sizes the §2.1 problem.)
- Do the catalog's OpenRouter models return logprobs? (Determines whether the `confidence` looper
  works at all or silently degrades to "call everything.")
- Does the §2.2 inversion bite on the *real* hidden tasks, or only in the forced-expensive corner?
  (On cheap tasks a single-cheap route stays positive; the inversion needs a policy pushed into
  expensive fan-out.)

*Method note: the sharpest way to close the open items is a small live-grader spike — grade one fixed
transcript K times to measure judge variance, and probe logprob availability per model — rather than
more static reading.*
