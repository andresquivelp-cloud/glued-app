import { readCosts, changeCosts } from "@/lib/costs";
import { OpError } from "@/lib/deals";
import { json, fail, botOk, readJson } from "@/lib/api";

const NEED = "Send Authorization: Bearer <GLIDE_API_TOKEN>";
// The sales cost sheet (no team pay). ?month=2026-11
export async function GET(req: Request) {
  if (!botOk(req)) return fail(NEED, 401);
  const m = new URL(req.url).searchParams.get("month"), c = await readCosts();
  return json({ updated_at: c.updated_at, rows: m ? c.rows.filter((r) => r.month === m) : c.rows });
}
// Add or update lines: { rows: [ { id?, month, brand, category, item, amount, type, status, note } ] }. Remove: { remove: [ids] }
export async function POST(req: Request) {
  if (!botOk(req)) return fail(NEED, 401);
  const b = await readJson(req); if (!b) return fail("Send JSON: { rows: [ ... ] }");
  try { const r = await changeCosts(b.rows, b.remove, "grokbot"); return json({ ok: true, added: r.added, updated: r.updated, removed: r.removed, rows: r.store.rows.length }); }
  catch (e) { if (e instanceof OpError) return fail(e.message); throw e; }
}
