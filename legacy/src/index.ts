import express from "express";
import { initSigner, signerAddress } from "./signer.js";
import { loadConfig } from "./config.js";
import { chat } from "./routes/chat.js";
import { trace } from "./routes/trace.js";
import { recipe } from "./routes/recipe.js";
import { health } from "./routes/health.js";
import { cors } from "./cors.js";

initSigner();
const cfg = loadConfig();

const app = express();
app.use(cors);
// Capture the exact raw body so input_hash is over what the client actually sent.
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  }),
);

app.use(chat);
app.use(trace);
app.use(recipe);
app.use(health);

const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => {
  // Startup attest log — no secrets. Signer address + policy hash only.
  console.log(
    `attested-router v${cfg.routerVersion} listening on :${port} | signer=${signerAddress()} | policy_hash=${cfg.policyHash}`,
  );
});
