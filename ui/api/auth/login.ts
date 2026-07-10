const APP_URL = process.env.APP_URL || "https://arena-router-ui.vercel.app";
const CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";

export default function handler(_req: any, res: any) {
  if (!CLIENT_ID) { res.status(500).send("GitHub OAuth not configured (GITHUB_CLIENT_ID missing)"); return; }
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", `${APP_URL}/api/auth/callback`);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("allow_signup", "true");
  res.redirect(302, url.toString());
}
