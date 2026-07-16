# Anti-abuse — score integrity (task-agnosticity)

Implements [ci-anti-abuse.md](../../docs/ci-anti-abuse.md) §3a. Terminal-Bench
tasks are **public, solutions included** — so the cheat isn't stealing answers,
it's *embedding* them. These are the layered defenses. All are **triage**: they
route attention; humans make the final call.

| File | Layer | Runs | Cost |
|---|---|---|---|
| `tripwire.mjs` + `task-ids.txt` + `solution-strings.txt` | 1 · static grep of the diff for the 89 task IDs / solution strings | every push | free |
| `judge.mjs` + `judge-prompt.md` | 2 · LLM judge on the diff → clean / suspicious / violation | every push | one cheap call |

Not here (elsewhere in the pipeline): mandatory human diff review before top
placement (§3a.3), and the token-anomaly flag in scoring (§3a.4).

## Use

```sh
# 1. static tripwire — exit 1 if it finds task IDs / solution strings
git diff origin/main...HEAD | node competition/anti-abuse/tripwire.mjs
git diff origin/main...HEAD | node competition/anti-abuse/tripwire.mjs --json

# 2. LLM judge — needs OPENROUTER_API_KEY (JUDGE_MODEL optional, default gpt-4o-mini)
git diff origin/main...HEAD | node competition/anti-abuse/judge.mjs --json
```

Verdict handling (§3a): `clean` → proceed · `suspicious` → proceed **and label
for human review** · `violation` → block pending maintainer override. `tripwire`
and `judge` are advisory inputs to that, never the final word.

## Tests

```sh
node --test competition/anti-abuse/*.test.mjs
```

## Maintenance

- `task-ids.txt` — the 89 task dirs from `laude-institute/terminal-bench-2`
  (regenerate: `gh api repos/laude-institute/terminal-bench-2/contents | jq -r '.[]|select(.type=="dir").name' | sort`).
- `solution-strings.txt` — maintainer-curated distinctive strings from task
  solutions; seeded empty (task-id matching already covers lazy embedding).
- `judge-prompt.md` — versioned; bump the version header when it changes so
  verdicts stay attributable. Transparent by design — authors can read it.
