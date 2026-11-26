import { readDoc } from "@/lib/store";
import { readStores, allBases, view } from "@/lib/deals";
import { readCosts } from "@/lib/costs";
import { readPlan } from "@/lib/plan";
import { json, fail, botOk } from "@/lib/api";

// Everything the app holds, raw, for checking against the tools: ?parts=days,projections,sync,leads,calls,deals,costs,plan,log (default: all)
export async function GET(req: Request) {
  if (!botOk(req)) return fail("Send Authorization: Bearer <GLIDE_API_TOKEN>", 401);
  const q = new URL(req.url).searchParams, want = new Set((q.get("parts") ?? "days,projections,sync,leads,calls,deals,costs,plan,log").split(",").map((s) => s.trim()));
  const [doc, stores, costs, plan] = await Promise.all([readDoc(), readStores(), readCosts(), readPlan()]);
  const out: Record<string, unknown> = { updated_at: doc.updated_at };
  if (want.has("days")) out.days = doc.days;
  if (want.has("projections")) out.projections = doc.projections;
  if (want.has("sync")) out.sync = doc.sync;
  if (want.has("leads")) out.leads = doc.leads;
  if (want.has("calls")) out.calls = doc.calls ?? [];
  if (want.has("deals")) out.deals = (await allBases(stores)).map((d) => view(d, stores[d.n]));
  if (want.has("costs")) out.costs = costs.rows;
  if (want.has("plan")) out.plan = plan.sales ?? null;
  if (want.has("log")) out.log = doc.log.slice(-100);
  out.how_to_change = {
    "days (sent, replies, positives, bounced, calls, capacity...)": "POST /api/v1/days",
    "booked calls": "POST /api/v1/calls", "deals (stage, checks, to-dos, notes, links, comments)": "POST /api/v1/deals",
    "channel plans (Forecast)": "POST /api/v1/projections", costs: "POST /api/v1/costs", "Plan tab": "POST /api/v1/plan", "every computed number": "GET /api/v1/metrics",
  };
  return json(out);
}
