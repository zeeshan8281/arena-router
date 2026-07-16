# Benchmark & Cost Survey — Harness-Efficiency Competition (GLM 5.2 via OpenRouter)

*Compiled 2026-07-16 from a multi-source, adversarially-verified research run (23 sources, 105 claims extracted, top 25 verified by 3-vote panels). Prices and task counts checked against primary sources on 2026-07-16.*

**Context.** Planned competition: participants modify a vanilla **pi** CLI harness connected to OpenRouter (plugins, skills, agent profiles — anything except pi source) to **minimize inference spend while meeting a fixed performance baseline** (plain GLM 5.2). This doc surveys candidate full benchmarks, their expected cost per run on GLM 5.2 only, and smoke-test strategies.

---

## 1. Pricing foundation (verified against primary sources)

| # | Fact | Value | Source |
|---|------|-------|--------|
| 1a | OpenRouter `z-ai/glm-5.2` | **$0.93/M input · $3.00/M output**, 1M context | openrouter.ai/z-ai/glm-5.2 |
| 1b | Z.ai direct pricing | $1.40/M in · $0.26/M cached-in · $4.40/M out | docs.z.ai/guides/overview/pricing |
| 1c | Cache reads (OpenRouter/Z.ai) | **~0.2x input price** (~80% discount) | openrouter.ai/docs/features/prompt-caching |
| 1d | Cache writes | **Free** (limited-time); caching fully automatic; `session_id` gives cache affinity | same |
| 1e | Per-request telemetry | `cached_tokens`, `cache_write_tokens`, `cache_discount` in responses + `/api/v1/generation` | same |
| 1f | Realistic prefix-reuse in agentic coding loops | 70–92% (traced Claude Code SWE-bench task: 92% reuse → 81% cost cut) | lmcache.ai trace; arXiv 2601.06007 (41–80% across providers) |

**Implication of 1e:** competition scoring can sum **actual billed dollars** from OpenRouter generation records — caching and every secondary effect included for free. No cost modeling needed.

**Cache assumption used below:** 85% of input tokens hit cache → effective input ≈ $0.30/M.

---

## 2. Per-task token/cost model (the load-bearing assumption)

Per-task spend on agentic coding benchmarks is dominated by the harness, not the benchmark:

- **Lean scaffold** (mini-SWE-agent-style): ~90k in / 20k out per task (benchmarkingagents.com calculator; ±1.5x self-reported error).
- **Full CLI agent** (Claude-Code-style, ≈ vanilla pi): **~2M input tokens per task** across ~92 LLM calls (traced SWE-bench Verified run).
- Same task varies **up to 30x in tokens across runs** (arXiv 2604.22750) — score smoke gates on median-of-N, not single runs.

Per-task cost at GLM 5.2 rates:

| Harness style | Tokens/task (in / out) | No-cache | 85% cache |
|---------------|------------------------|----------|-----------|
| Lean scaffold | 90k / 20k | **$0.14** | **$0.09** |
| Full CLI agent (pi-like) | 2M / 40k | **$1.98** | **$0.68** |

Since the competition is literally about harness efficiency, entrants will span this whole range. **Budget CI for the full-CLI-agent column.**

---

## 3. Comparison table (full runs, GLM 5.2 only)

Cost columns give **lean-scaffold → full-CLI-agent** range using §2 per-task figures (agentic benchmarks), or measured/published totals where available.

| # | Benchmark | Tasks | Evaluates | Smoke subset | $/run no-cache | $/run ~85% cache | Native cost reporting | pi-compatible? |
|---|-----------|-------|-----------|--------------|----------------|------------------|----------------------|----------------|
| 3a | SWE-bench Verified | 500 | Repo bug-fixing (Docker) | Lite; 10–25-task pinned slice | $70 → $990 | $45 → $340 | No | Yes (Docker env, agent brings itself) |
| 3b | SWE-bench Lite | 300 | Same, cost-curated subset | 10–25-task slice | $42 → $590 | $27 → $200 | No | Yes |
| 3c | Terminal-Bench 2.x | 89 | Terminal-agent mastery (Harbor) | any slice; TB1 (80) | $12 → $175 | $8 → $60 | No (but see 4c) | **Yes — terminal-native, ideal fit** |
| 3d | tau2-bench | 165 core (retail 115 + airline 50; +telecom, banking) | Conversational tool use w/ simulated user | `--num-tasks N`, `mock` domain | ~$12 (×3 trials ~$36) | ~$8–25 | No | Partial — bench drives the LLM via LiteLLM; pi itself isn't in the loop |
| 3e | BFCL v4 | 2,000+ | Pure function/tool calling | `simple_function` (~300) | ~$11 | ~$9 (short prompts cache poorly) | **Yes (cost + latency)** | Partial — same caveat as 3d |
| 3f | GAIA (HAL 165-val) | 165 of 450 | General agent: browsing, tools, multimodal files | Level-1 only | ~$8 | ~$5 | **Yes ($ column, explicitly no-cache)** | Mostly — needs web + file tooling |
| 3g | Aider polyglot | 225 | Code editing inside **aider's own harness** | language slice | **~$10 (measured-class)** | ~$8 | **Yes (cost + token columns)** | **No — see §5** |
| 3h | SWE-bench-Live | rolling (frozen Lite/Verified) | Contamination-free SWE-bench, multi-lang/OS | frozen Lite | ≈ 3a/3b | ≈ | No | Linux yes; Windows split no |
| 3i | Commit0 | 54 libs | Build whole libraries from scratch | low-test-count libs | likely $100s–$1000s (unbounded per-task) | — | No | Yes but per-task scope huge |
| 3j | AgentBench | 8 envs (~13k generations) | General LLM-as-agent | Dev split (~4k gens) | ~$40–60 | ~$30 | No | Poor — heavy Docker infra (16GB-RAM workers, Freebase DB). Avoid |

**Reading the ranges:** the spread within a row is harness efficiency (the thing being competed on); the spread between rows 3a–3c is mostly **task count** (500 vs 300 vs 89) — per-task cost is similar. Terminal-Bench ≈ 0.3× SWE-bench Lite ≈ 0.18× SWE-bench Verified.

Data quality: 3a–3c per-task figures triangulated from a published trace + calculator estimates (±1.5x); 3d–3f from calculator estimates (±1.5x); 3g from the leaderboard's own measured cost column (high confidence); 3i–3j order-of-magnitude only.

---

## 4. Cost/efficiency methodology to piggyback on

| # | Leaderboard | What it reports | Caching handled? |
|---|-------------|-----------------|------------------|
| 4a | Aider polyglot | $/run + prompt/completion token totals | No |
| 4b | BFCL | $/run + latency | No |
| 4c | **Artificial Analysis Coding Agents** | **Cost-per-task incl. standard input, discounted cached input, cache writes, output**; fixes one model across harnesses to isolate harness effects | **Yes — copy this** |
| 4d | HAL (Princeton) | $/run per agent+model, min–max across runs | Explicitly no-cache |

4c is structurally identical to this competition (fixed model, varying harness, cache-aware cost). Note their caveat: cache hit rates vary by provider routing; they deliberately do *not* force cache affinity. Decide explicitly whether entrants may use `session_id` affinity (recommended: yes, it's representative of real usage).

---

## 5. Why Aider polyglot is cheap but disqualifying as the main benchmark

Aider polyglot **is** aider: the benchmark runs each exercise through aider's own fixed edit loop (two attempts, fixed edit formats). There is no place to plug pi in — the harness under test *is the benchmark runner*. A participant's pi plugins/skills/context-engineering would never execute, so the competition would measure GLM 5.2 + aider, identically for every entrant. Its ~$10 measured cost also reflects exactly why it's unsuitable: ~24k tokens/exercise means no long agentic context, so caching and context management — the main cost levers being competed on — barely register. Useful as a cheap *model-level* sanity probe; useless as the competition surface.

Same reasoning applies partially to tau2-bench/BFCL (3d/3e): they drive the model API directly, so "harness" shrinks to prompt/tool-schema shaping unless we build a pi adapter.

---

## 6. Smoke-test strategy (local iteration + CI gate)

1. **Subset**: 10–25 tasks, pinned seed, fixed task list (practitioner consensus for regression CI). At full-CLI-agent rates: 15 tasks ≈ $10–30 no-cache, ~$4–10 cached.
2. **Variance control**: 30x per-task token variance → median-of-3 trials for the smoke gate; single run is noise.
3. **Cost accounting**: read actual billed cost from OpenRouter generation records (`cache_discount` included) rather than estimating.
4. **Representativeness**: draw smoke tasks stratified from the full benchmark's difficulty distribution; re-validate smoke→full rank correlation once baselines exist (open question).
5. **Two-stage CI** (matches planned PR flow): smoke gate (~$10) must beat current best cost at ≥ baseline pass rate → only then run full benchmark (~$60–340 cached depending on choice of 3a–3c).

---

## 7. Corrections & refuted claims from verification

- **SWE-bench Multimodal = 617 instances**, not 517 — the 517 on swe-agent-bench.github.io is stale; paper (arXiv 2410.03859) and HF dataset say 617. (Killed 3-0 / 2-1 by verify panels.)
- OpenRouter's "caching 60–80% cheaper" banner is marketing shorthand; the endpoints API publishes exact `input_cache_read` rates (~0.2x input) — use those.
- benchmarkingagents.com calculator internally contradicts itself on SWE-bench Verified ($285 table vs "low thousands" FAQ) — treat as ±1.5x order-of-magnitude.

## 8. Open questions

1. GLM 5.2 baseline pass-rate on Terminal-Bench 2.x / SWE-bench Lite under vanilla pi (needs a probe run, not web research).
2. Smoke-subset → full-benchmark rank predictiveness for *cost* (not just accuracy).
3. Model allowlist: GLM-5.2-only vs open-weights subset (GLM-4.6 at $0.60/$2.20 and GLM-4.5-Air at $0.20/$1.10 would change baseline economics).
4. Whether to build a pi adapter for tau2/BFCL if a tool-call-scoped track is added later.

## 9. Recommendation

Full-harness scope is affordable — no need to cut to tool-call-only benchmarks (which would neutralize the caching/context levers anyway, §5). **Terminal-Bench 2.x as the full CI benchmark** (89 tasks, terminal-native = pi's exact modality, ~$8–60/run cached; Z.ai even publishes a "Terminal-Bench 2.0 Verified" variant so GLM-family baselines exist), with **SWE-bench Lite as an optional harder tier** (~$27–200 cached), and a 15–20-task pinned smoke subset keeping per-PR CI ≈ $10.

---

## 10. Model allowlist data — open-weights models on OpenRouter

*Added 2026-07-16. Rankings from OpenRouter's live "This Week" chart (browser-rendered, fetched 05:58 UTC); pricing from the catalog API (`/api/v1/models`, provider-averaged — model pages may differ by a cent, e.g. GLM 5.2 shows $0.93/$3.00 on its page vs $0.95/$2.99 in the API).*

**Decision context:** benchmark = Terminal-Bench 2.x (§9), baseline model = GLM 5.2. The open question is whether entrants are locked to GLM 5.2 or may use any allowlisted open-weights model (making cheap-model routing a legal strategy).

### 10.1 Verified by real weekly token volume

OpenRouter's rankings page shows only the top ~20 models overall; after excluding proprietary models and `:free` variants, exactly 8 open-weights models carry verified usage numbers.

| # | Model ID | Lab | License | In $/M | Out $/M | Cached-in $/M | Context | Weekly tokens |
|---|----------|-----|---------|--------|---------|---------------|---------|---------------|
| 1 | `xiaomi/mimo-v2.5` | Xiaomi | Custom open | 0.14 | 0.28 | ~0* | 1M | 8.03T |
| 2 | `deepseek/deepseek-v4-flash` | DeepSeek | MIT | 0.10 | 0.20 | 0.02 | 1M | 5.22T |
| 3 | `minimax/minimax-m3` | MiniMax | Custom open | 0.30 | 1.20 | 0.06 | 1M | 4.04T |
| 4 | **`z-ai/glm-5.2`** (baseline) | Zhipu/Z.ai | Custom open | 0.95 | 2.99 | 0.18 | 1M | 3.29T |
| 5 | `deepseek/deepseek-v4-pro` | DeepSeek | MIT | 0.43 | 0.87 | ~0* | 1M | 2.54T |
| 6 | `stepfun/step-3.7-flash` | StepFun | Custom open | 0.20 | 1.15 | 0.04 | 256K | 946B |
| 7 | `xiaomi/mimo-v2.5-pro` | Xiaomi | Custom open | 0.43 | 0.87 | ~0* | 1M | 645B |
| 8 | `openai/gpt-oss-120b` | OpenAI (open) | MIT | 0.04 | 0.17 | – | 131K | 528B |

\* Catalog API reports $0.00 cached-input — likely free cache reads or provider averaging; verify per-provider before relying on it in scoring.

### 10.2 Proxy-ranked fill to 20 (NOT in OR weekly top-20; ecosystem-adoption judgment, no usage numbers)

| # | Model ID | License | In $/M | Out $/M | Cached-in $/M | Context |
|---|----------|---------|--------|---------|---------------|---------|
| 9 | `qwen/qwen3.7-plus` | Apache-2.0 | 0.32 | 1.28 | 0.06 | 1M |
| 10 | `qwen/qwen3.7-max` | Apache-2.0 | 1.48 | 4.42 | 0.29 | 1M |
| 11 | `qwen/qwen3.5-plus-20260420` | Apache-2.0 | 0.30 | 1.80 | – | 1M |
| 12 | `deepseek/deepseek-v3.2` | MIT | 0.27 | 0.40 | 0.13 | 164K |
| 13 | `meta-llama/llama-4-maverick` | Llama license | 0.20 | 0.80 | – | 1M |
| 14 | `meta-llama/llama-4-scout` | Llama license | 0.10 | 0.30 | – | 10M |
| 15 | `mistralai/mistral-medium-3-5` | Apache-2.0 | 1.50 | 7.50 | – | 262K |
| 16 | `mistralai/mistral-small-2603` | Apache-2.0 | 0.15 | 0.60 | 0.01 | 262K |
| 17 | `google/gemma-4-31b-it` | Gemma Terms | 0.22 | 0.55 | 0.12 | 262K |
| 18 | `z-ai/glm-5.1` | Custom open | 0.97 | 3.04 | 0.18 | 203K |
| 19 | `moonshotai/kimi-k2.7-code` | Custom open | 0.72 | 3.49 | 0.15 | 262K |
| 20 | `nousresearch/hermes-3-llama-3.1-70b` | Llama license | 0.70 | 0.70 | – | 131K |

### 10.3 Implications for the allowlist decision

1. **GLM 5.2 as baseline is validated** — #4 open-weights model by real usage, and the most expensive of the verified top 5, so cost headroom below it genuinely exists.
2. **The cheap tier is mainstream, not fringe**: the two most-used open models (MiMo v2.5, DeepSeek V4 Flash) are 5–10x cheaper than GLM 5.2. If multi-model routing is legal, "route easy tasks to Flash" dominates immediately — decide whether that's the point or a confound.
3. **Natural allowlist criterion** if multi-model: "open-weights models in OpenRouter's weekly top 20" — the 8 verified models. Non-arbitrary, re-derivable each season, and guarantees well-supported endpoints with working caching.
4. **Rules requirement:** explicitly ban `:free` variants (`tencent/hy3:free` was #1 overall at 8.98T weekly tokens) — they zero out the cost metric and break the competition.
5. **No coding-specific ranking exists** on OpenRouter (only per-language usage charts), so overall-weekly is the best available popularity signal.
