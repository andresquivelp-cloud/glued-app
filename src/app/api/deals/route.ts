import { readStores, changeDeal, createDeal, seedBases, OpError, type Op } from "@/lib/deals";
import { json, fail, personOr401, readJson } from "@/lib/api";

// The deal pop-ups. GET: what the team changed or added on every deal. POST: one deal's changes, or a new deal.
export async function GET() {
  const u = await personOr401(); if (u instanceof Response) return u;
  return json(await readStores());
}

// { name, ops: [ { op: "comment_add", text }, ... ] }  or  { create: { name, brand, ... } }
export async function POST(req: Request) {
  const u = await personOr401(); if (u instanceof Response) return u;
  const b = await readJson(req); if (!b) return fail("Send JSON");
  const who = u.pid ?? u.email;
  try {
    if (b.seed) { const r = await seedBases(b.seed, u.email); return json({ ok: true, added: r.added, deals: r.stores }); }
    if (b.create && typeof b.create === "object") { const r = await createDeal(b.create as Record<string, unknown>, who, u.email); return json({ ok: true, name: r.base.n, deal: r.stored }); }
    const name = typeof b.name === "string" ? b.name : "";
    if (!name) return fail("name is the deal's name");
    const r = await changeDeal(name, b.ops as Op[], who, u.email);
    return json({ ok: true, name: r.base.n, deal: r.stored });
  } catch (e) {
    if (e instanceof OpError) return fail(e.message);
    throw e;
  }
}
