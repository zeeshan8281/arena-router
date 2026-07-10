import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.COOKIE_SECRET || "dev";
function readSession(cookie?: string): { login: string } | null {
  const raw = (cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith("arena_session="));
  if (!raw) return null;
  const [body, mac] = decodeURIComponent(raw.slice("arena_session=".length)).split(".");
  if (!body || !mac) return null;
  const exp = createHmac("sha256", SECRET).update(body).digest("base64url");
  if (mac.length !== exp.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(exp))) return null;
  try { const { login, exp: e } = JSON.parse(Buffer.from(body, "base64url").toString()); if (!login || Date.now() > e) return null; return { login }; } catch { return null; }
}

export default function handler(req: any, res: any) {
  const s = readSession(req.headers?.cookie);
  res.json({ login: s?.login ?? null, configured: Boolean(process.env.GITHUB_CLIENT_ID) });
}
