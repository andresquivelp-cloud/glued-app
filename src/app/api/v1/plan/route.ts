import { readPlan, writePlan, PLAN_FIELDS } from "@/lib/plan";
import { json, fail, botOk, readJson } from "@/lib/api";

const NEED = "Send Authorization: Bearer <GLIDE_API_TOKEN>";
// The Sales Plan tab (tasks, milestones, decisions, payments, status updates), as the app saves it, with its version
export async function GET(req: Request) {
  if (!botOk(req)) return fail(NEED, 401);
  const p = await readPlan(); return json(p.sales ?? { v: 0, data: null, note: "Nobody has opened the Plan tab in the app yet" });
}
// Replace it: { base: <the v you read>, data: { tasks, items, ... } }. Refused (409) if someone saved since you read it
export async function POST(req: Request) {
  if (!botOk(req)) return fail(NEED, 401);
  const b = await readJson(req); if (!b || !b.data || typeof b.data !== "object") return fail("Send { base, data }");
  const data = Object.fromEntries(PLAN_FIELDS.filter((k) => k in (b.data as object)).map((k) => [k, (b.data as Record<string, unknown>)[k]]));
  if (!Array.isArray(data.tasks)) return fail("data.tasks must be a list");
  const all = await readPlan(), cur = all.sales, base = typeof b.base === "number" ? b.base : -1;
  if ((cur?.v ?? 0) !== base) return json({ error: "The plan changed since you read it. Read it again and redo your change.", current_version: cur?.v ?? 0 }, 409);
  all.sales = { v: (cur?.v ?? 0) + 1, data, updated_at: new Date().toISOString(), updated_by: "grokbot" };
  await writePlan(all); return json({ ok: true, v: all.sales.v });
}
