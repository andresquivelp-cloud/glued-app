import { timingSafeEqual, createHash } from "node:crypto";
import { currentUser, type AppUser } from "./session";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const fail = (error: string, status = 400, extra?: object) => json({ error, ...extra }, status);

const same = (a: string, b: string) => {
  const x = createHash("sha256").update(a).digest(), y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
};

// Grokbot (and any script) sends: Authorization: Bearer <GLIDE_API_TOKEN>
export function botOk(req: Request) {
  const token = process.env.GLIDE_API_TOKEN;
  const h = req.headers.get("authorization") ?? "";
  const got = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  return !!token && token.length >= 32 && !!got && same(got, token);
}

// Pages in the app: a signed-in teammate
export async function personOr401(): Promise<AppUser | Response> {
  const u = await currentUser();
  return u ?? fail("Sign in again", 401);
}

// Vercel's daily job sends: Authorization: Bearer <CRON_SECRET>
export function cronOk(req: Request) {
  const s = process.env.CRON_SECRET, h = req.headers.get("authorization") ?? "";
  return !!s && same(h, `Bearer ${s}`);
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try { const j = await req.json(); return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null; } catch { return null; }
}
