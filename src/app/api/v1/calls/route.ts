import { addCalls, removeCalls, listCalls } from "@/lib/calls";
import { OpError } from "@/lib/deals";
import { json, fail, botOk, readJson } from "@/lib/api";

const NEED = "Send Authorization: Bearer <GLIDE_API_TOKEN>";
// Booked calls. ?from=2026-11-01&to=2026-11-30 (booking days)
export async function GET(req: Request) {
  if (!botOk(req)) return fail(NEED, 401);
  const q = new URL(req.url).searchParams, calls = await listCalls(q.get("from"), q.get("to"));
  return json({ count: calls.length, calls });
}
// Add or update calls: { calls: [ { id?, at, booked_at?, person, email, company, brand, channel, source?, status?, deal?, notes? } ] }. Remove: { remove: [ids] }
export async function POST(req: Request) {
  if (!botOk(req)) return fail(NEED, 401);
  const b = await readJson(req); if (!b) return fail("Send JSON: { calls: [ ... ] }");
  try {
    if (b.remove) return json({ ok: true, ...(await removeCalls(b.remove, "grokbot")) });
    return json({ ok: true, ...(await addCalls(b.calls ?? (b.at ? [b] : null), "grokbot")) });
  } catch (e) { if (e instanceof OpError) return fail(e.message); throw e; }
}
