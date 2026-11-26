import { readStores, allBases, view, findDeal, changeDeal, createDeal, OpError, STAGES, type Op } from "@/lib/deals";
import { json, fail, botOk, readJson } from "@/lib/api";

const NEED = "Send Authorization: Bearer <GLIDE_API_TOKEN>";

// Every deal on the Pipeline, as the app shows it. Filters: name (one deal), stage, owner, brand, temperature, q (searches name, contact, email, company).
export async function GET(req: Request) {
  if (!botOk(req)) return fail(NEED, 401);
  const q = new URL(req.url).searchParams, stores = await readStores();
  const name = q.get("name");
  if (name) { const d = await findDeal(name, stores); return d ? json({ deal: view(d, stores[d.n]) }) : fail(`No deal called "${name}"`, 404); }
  const has = (v: string | null, x: string) => !v || x.toLowerCase() === v.toLowerCase();
  const text = (q.get("q") ?? "").toLowerCase();
  const deals = (await allBases(stores)).map((d) => view(d, stores[d.n])).filter((d) =>
    has(q.get("stage"), d.stage) && has(q.get("owner"), d.owner) && has(q.get("brand"), d.brand) && has(q.get("temperature"), d.temperature)
    && (!text || [d.name, d.contact.person, d.contact.email, d.contact.company].some((x) => (x ?? "").toLowerCase().includes(text))));
  return json({ count: deals.length, stages: STAGES, deals });
}

// Change one deal: { name, ops: [...] }.  Add a deal: { create: { name, brand, stage?, value?, probability?, owner?, next_step?, next_step_due?, contact?: { person, title, email, company }, ops?: [...] } }
// Changes made here show in the app as Grokbot.
export async function POST(req: Request) {
  if (!botOk(req)) return fail(NEED, 401);
  const b = await readJson(req); if (!b) return fail("Send JSON: { name, ops: [ { op, ... } ] }");
  try {
    if (b.create && typeof b.create === "object") { const r = await createDeal(b.create as Record<string, unknown>, "grok", "grokbot"); return json({ ok: true, deal: r.view }, 201); }
    const name = typeof b.name === "string" ? b.name : "";
    if (!name) return fail("name is the deal's name (GET /api/v1/deals lists them)");
    const r = await changeDeal(name, b.ops as Op[], "grok", "grokbot");
    return json({ ok: true, deal: r.view });
  } catch (e) {
    if (e instanceof OpError) return fail(e.message);
    throw e;
  }
}
