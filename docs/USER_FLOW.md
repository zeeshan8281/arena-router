# AutoRouter Arena — user flow

How a participant goes from landing on the site to a verifiable, enclave-signed score on the leaderboard — and what happens under the hood at each step.

```mermaid
flowchart TD
  U([👤 Participant]) --> SITE[Arena site<br/>arena-router-ui.vercel.app]
  SITE --> READ[Browse: benchmark · models · scoring<br/>how grading works · leaderboard]
  READ --> CHOOSE{How to submit?}

  %% ---- CLI path ----
  CHOOSE -->|CLI| C1[npm i -g ./arena]
  C1 --> C2[autorouter login &lt;handle&gt;]
  C2 --> C3[autorouter clone → edit policy.ts]
  C3 --> C4["autorouter run<br/>score locally on the PUBLIC dev set<br/>(instant · offline · precomputed outcomes)"]
  C4 -->|iterate| C3
  C4 --> C5[autorouter submit]

  %% ---- Web path ----
  CHOOSE -->|Web| W1[Sign in with GitHub · OAuth]
  W1 --> W2[verified identity → gh:username]
  W2 --> W3[write / paste decide policy]
  W3 --> W4[Submit]

  C5 --> POST[/POST policy → grader/]
  W4 --> POST

  %% ---- Grader enclave ----
  POST --> G
  subgraph G [🔒 Grader · Intel TDX enclave on EigenCompute]
    direction TB
    G1[transpile TS → JS] --> G2["run decide over N HIDDEN prompts<br/>under SES sandbox — no net/fs/process"]
    G2 --> G3[simulate looper over sealed outcomes]
    G3 --> G4["score = mean(quality) − λ·mean(cost) + β·oss_rate"]
    G4 --> G5["sign ScoreReceipt<br/>{policy_hash, eval_set_hash, results_root, score}<br/>with KMS-derived enclave key"]
  end

  G5 --> R[signed score returned]
  R --> V["browser verifies the signature<br/>ethers.verifyMessage → grader's on-chain address"]
  V --> LB[[🏆 Leaderboard · enclave-signed, verifiable]]
  LB -.-> U

  classDef tee fill:#f3f0ff,stroke:#1a0c6d,color:#1a0c6d;
  class G,G1,G2,G3,G4,G5 tee;
```

## What's happening, in words

1. **Land & browse** — the participant opens the Arena site and reads the benchmark (models, prices, scoring params `λ`/`β`, hidden-set hash) and the live leaderboard.
2. **Pick a path:**
   - **CLI** — install the `autorouter` CLI, `login`, `clone` a workspace, edit `policy.ts` (the `decide()` function), and `run` it locally against a **public dev set** (precomputed per-model outcomes → instant, offline). Iterate until the score looks good, then `submit`.
   - **Web** — **Sign in with GitHub** (OAuth) so the submission is tied to a *verified* identity (`gh:username`), then write/paste the policy and hit **Submit**.
3. **Grade in the enclave** — the grader (Intel TDX on EigenCompute) transpiles the policy, runs `decide()` under **SES capability isolation** (no `fetch`/`fs`/`process`, killed on timeout) over the **sealed hidden set** the participant never sees, simulates the chosen looper, computes `score = mean(quality) − λ·mean(cost) + β·oss_rate`, and **signs** a ScoreReceipt with a key that only exists inside the measured image.
4. **Verify & rank** — the signed score comes back; the browser recovers the signer with `ethers.verifyMessage` and checks it against the grader's on-chain Derived Address. The result lands on the leaderboard — and anyone can re-verify it, so no number can be faked.

## Trust boundary at a glance

- **You control:** only the `decide()` policy.
- **You never see:** the hidden prompts (sealed; decrypt only in the enclave).
- **You can't fake:** the score (signed by the enclave key) or, on the web path, your identity (GitHub-verified).
