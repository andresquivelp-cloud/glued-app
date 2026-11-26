import { readCosts, changeCosts } from "@/lib/costs";
import { OpError } from "@/lib/deals";
import { json, fail, personOr401, readJson } from "@/lib/api";

// The app: read the cost sheet, and send it once from the sealed bundle when the server has none yet ({ seed: [...] })
export async function GET() {
  const u = await personOr401(); if (u instanceof Response) return u;
  return json(await readCosts());
}
export async function POST(req: Request) {
  const u = await personOr401(); if (u instanceof Response) return u;
  const b = await readJson(req); if (!b || !Array.isArray(b.seed)) return fail("Send { seed: [ ... ] }");
  try { const r = await changeCosts(b.seed, null, u.email, true); return json(r.store); }
  catch (e) { if (e instanceof OpError) return fail(e.message); throw e; }
}
