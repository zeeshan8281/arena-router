import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.COOKIE_SECRET || "dev";
const GRADER = process.env.GRADER_URL || "http://34.7.20.95:8080";
function readSession(cookie?: string): { login: string; token: string } | null {
  const raw = (cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith("arena_session="));
  if (!raw) return null;
  const [body, mac] = decodeURIComponent(raw.slice("arena_session=".length)).split(".");
  if (!body || !mac) return null;
  const exp = createHmac("sha256", SECRET).update(body).digest("base64url");
  if (mac.length !== exp.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(exp))) return null;
  try { const { login, token, exp: e } = JSON.parse(Buffer.from(body, "base64url").toString()); if (!login || Date.now() > e) return null; return { login, token: token ?? "" }; } catch { return null; }
}

// Web submissions MUST be signed in with GitHub — participant is forced to the
// verified GitHub login, so you cannot submit as someone else.
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const session = readSession(req.headers?.cookie);
  if (!session) { res.status(401).json({ error: "sign in with GitHub to submit" }); return; }
  if (!session.token) { res.status(401).json({ error: "please sign out and sign in with GitHub again" }); return; }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  if (!body.policy || typeof body.policy !== "string") { res.status(400).json({ error: "policy required" }); return; }
  try {
    // Forward the GitHub token — the grader verifies it and derives the name
    // (gh:<login>) itself, so the client can't pick an arbitrary participant.
    const r = await fetch(`${GRADER}/submit`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy: body.policy, github_token: session.token, note: (body.note || "").slice(0, 200) }),
    });
    res.status(r.status).json(await r.json());
  } catch (e: any) {
    res.status(502).json({ error: `grader unreachable: ${e.message}` });
  }
}
