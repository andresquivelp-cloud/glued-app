import { readPlan, writePlan, SCOPES, PLAN_FIELDS } from "@/lib/plan";
import { json, fail, personOr401, readJson } from "@/lib/api";

export async function GET() {
  const u = await personOr401(); if (u instanceof Response) return u;
  return json(await readPlan());
}

// { scope: "sales", base: <version you loaded>, data: { tasks, items, ... } }
export async function POST(req: Request) {
  const u = await personOr401(); if (u instanceof Response) return u;
  const b = await readJson(req); if (!b) return fail("Send JSON");
  const scope = String(b.scope);
  if (!(SCOPES as readonly string[]).includes(scope)) return fail("scope must be sales");
  if (!b.data || typeof b.data !== "object" || Array.isArray(b.data)) return fail("data must be an object");
  const data = Object.fromEntries(PLAN_FIELDS.filter((k) => k in (b.data as object)).map((k) => [k, (b.data as Record<string, unknown>)[k]]));
  if (!Array.isArray(data.tasks)) return fail("data.tasks must be a list");
  if (JSON.stringify(data).length > 3_000_000) return fail("The plan is too big to save");
  const all = await readPlan(), cur = all[scope], base = typeof b.base === "number" ? b.base : 0;
  if (cur && cur.v !== base) return json({ error: "Someone else changed the plan", current: cur }, 409);
  all[scope] = { v: (cur?.v ?? 0) + 1, data, updated_at: new Date().toISOString(), updated_by: u.email };
  await writePlan(all);
  return json({ ok: true, v: all[scope].v });
}
