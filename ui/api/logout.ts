const APP_URL = process.env.APP_URL || "https://arena-router-ui.vercel.app";

export default function handler(_req: any, res: any) {
  res.setHeader("Set-Cookie", "arena_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
  res.redirect(302, `${APP_URL}/`);
}
