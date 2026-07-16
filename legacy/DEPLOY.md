# Deploying to EigenCompute

Two apps: one **worker** per model (or one worker serving several), then the **conductor** pointed at the worker(s). Same image for both — the role is chosen at runtime by `ROLE_PUBLIC`.

## Prerequisites

```bash
npm install -g @layr-labs/ecloud-cli@latest   # need >= 0.4.3
ecloud auth login
ecloud auth whoami                             # your deployer address (needs Sepolia ETH for gas)
docker login                                   # a registry EigenCompute can pull from (Docker Hub public is simplest)
```

## 1. Build & push one image (linux/amd64)

```bash
docker build --platform linux/amd64 -t <you>/attested-router:v1 .
docker push <you>/attested-router:v1
```

The image must be `linux/amd64`, `EXPOSE 8080`, and listen on `0.0.0.0`. `src/main.ts` runs the conductor by default, or the worker when `ROLE_PUBLIC=worker`.

## 2. Deploy a worker

`worker.env` (values ending in `_PUBLIC` are attested/visible; everything else is sealed by KMS):

```
ROLE_PUBLIC=worker
PORT=8080
MODEL_IDS_PUBLIC=openai/gpt-4o-mini,openai/gpt-4o
WORKER_BACKEND_PUBLIC=openai
MODEL_API_BASE_PUBLIC=https://openrouter.ai/api/v1
MODEL_API_KEY=sk-or-...          # SEALED — only decrypts inside the enclave
```

```bash
printf 'n\nn\n' | ecloud compute app deploy \
  --name attested-worker \
  --image-ref <you>/attested-router:v1 \
  --skip-profile --env-file worker.env \
  --instance-type g1-standard-4t \
  --log-visibility public --resource-usage-monitoring enable \
  --force --verbose
```

Grab its IP: `ecloud compute app info attested-worker` (or the deploy output). Confirm it serves:
`curl http://<worker-ip>:8080/pubkey`.

## 3. Deploy the conductor

The conductor needs JSON env vars (`WORKERS_PUBLIC`, `ROUTING_RECIPE_PUBLIC`). **Base64-encode them** — raw JSON gets mangled by the env pipeline and the app will crash at boot with `not valid JSON`. The app auto-detects and decodes base64 (still public — anyone can decode a `_PUBLIC` var).

```bash
WORKERS='{"openai/gpt-4o-mini":"http://<worker-ip>:8080","openai/gpt-4o":"http://<worker-ip>:8080"}'
RECIPE='{"bands":{"low":{"looper":"single","models":["openai/gpt-4o-mini"]},"med":{"looper":"single","models":["openai/gpt-4o"]},"high":{"looper":"confidence","models":["openai/gpt-4o-mini","openai/gpt-4o"]}},"params":{"confidence_threshold":0.5,"remom_rounds":2}}'

cat > conductor.env <<EOF
ROLE_PUBLIC=conductor
PORT=8080
ROUTER_VERSION_PUBLIC=1.0.0
WORKERS_PUBLIC=$(printf '%s' "$WORKERS" | base64)
ROUTING_RECIPE_PUBLIC=$(printf '%s' "$RECIPE" | base64)
EOF

printf 'n\nn\n' | ecloud compute app deploy \
  --name attested-router \
  --image-ref <you>/attested-router:v1 \
  --skip-profile --env-file conductor.env \
  --instance-type g1-standard-4t \
  --log-visibility public --resource-usage-monitoring enable \
  --force --verbose
```

## 4. Post-deploy checklist

- `curl http://<conductor-ip>:8080/health` → `{ ok, signer, policy_hash }`.
- `GET /pubkey` on each app matches its **EVM (Derived) Address** on `https://verify-sepolia.eigencloud.xyz/app/<app-id>`.
- `POST /v1/route`, then `node scripts/verify.mjs http://<conductor-ip>:8080 <task_id>` → `CHAIN VERIFIED`.

## Gotchas I actually hit

| Symptom | Cause | Fix |
|---|---|---|
| Commands hang forever | CLI update prompt eating stdin | pipe `printf 'n\n'` into every `ecloud` call |
| `Cannot confirm … in non-interactive mode` | newer CLI | add `--force` |
| `"Choose deployment method" / Provide --dockerfile` | a `Dockerfile` is present when deploying by `--image-ref` | move it aside for the deploy (`mv Dockerfile Dockerfile.keep`) |
| App `Running` but port refuses | app crashed after container start | `ecloud compute app logs <id>` — usually a bad env var |
| `ROUTING_RECIPE_PUBLIC is not valid JSON` | raw JSON mangled in env pipeline | base64-encode it (§3) |
| `docker build ... \| tail` "succeeds" but ships stale image | pipe hides build failure; push sends old local image | don't pipe build to `tail`; check its exit code; use a fresh tag |

## One image, two roles

`ROLE_PUBLIC=worker` → `dist/worker/index.js`; anything else → `dist/index.js` (conductor). EigenCompute runs the image's `CMD` (no per-app override), so the role travels in the attested env, not the command line.
