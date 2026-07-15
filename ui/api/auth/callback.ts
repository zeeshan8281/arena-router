import { createHmac } from "node:crypto";

const APP_URL = process.env.APP_URL || "https://arena-router-ui.vercel.app";
const CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const SECRET = process.env.COOKIE_SECRET || "dev";

function makeSession(login: string, token: string): string {
  // token kept server-side only (HttpOnly cookie) so /api/submit can prove the
  // GitHub identity to the grader. read:user scope, never exposed to the client.
  const body = Buffer.from(JSON.stringify({ login, token, exp: Date.now() + 7 * 86400000 })).toString("base64url");
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}

export default async function handler(req: any, res: any) {
  const code = req.query?.code;
  if (!code) { res.redirect(302, `${APP_URL}/?auth=error`); return; }
  try {
    const tok = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
    }).then((r) => r.json());
    if (!tok.access_token) throw new Error("no token");
    const user = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${tok.access_token}`, "user-agent": "autorouter-arena" },
    }).then((r) => r.json());
    if (!user.login) throw new Error("no login");
    res.setHeader("Set-Cookie", `arena_session=${encodeURIComponent(makeSession(user.login, tok.access_token))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);
    res.redirect(302, `${APP_URL}/?auth=ok`);
  } catch {
    res.redirect(302, `${APP_URL}/?auth=error`);
  }
}
