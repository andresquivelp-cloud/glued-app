import { metrics } from "@/lib/metrics";
import { json, fail, botOk } from "@/lib/api";

// Every number on the Sales tabs: Financials, Analytics and Forecast. ?from=2026-11-01&to=2026-11-25&brand=both|glued|ds
export async function GET(req: Request) {
  if (!botOk(req)) return fail("Send Authorization: Bearer <GLIDE_API_TOKEN>", 401);
  const q = new URL(req.url).searchParams;
  return json(await metrics({ from: q.get("from"), to: q.get("to"), brand: q.get("brand") }));
}
