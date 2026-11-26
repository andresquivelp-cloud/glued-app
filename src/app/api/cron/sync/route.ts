import { runSync } from "@/lib/sync";
import { json, fail, cronOk } from "@/lib/api";
import { timingSafeEqual, createHash } from "node:crypto";

export const maxDuration = 300;

// Vercel runs this every morning (vercel.json). Also callable by hand with ?token=<CRON_SECRET>;
// ?full=1 pulls every day again from January, ?debug=1 shows what each source sent back.
const tokenOk = (t: string | null) => {
  const s = process.env.CRON_SECRET; if (!s || !t) return false;
  return timingSafeEqual(createHash("sha256").update(t).digest(), createHash("sha256").update(s).digest());
};

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (!cronOk(req) && !tokenOk(q.get("token"))) return fail("Not allowed", 401);
  const { doc, report } = await runSync("cron", { full: q.get("full") === "1" });
  const days = Object.keys(doc.days).sort();
  const byMonth: Record<string, Record<string, number>> = {};
  for (const d of days) for (const [ch, c] of Object.entries(doc.days[d])) {
    const m = (byMonth[d.slice(0, 7)] ??= {});
    for (const f of ["sent", "replies", "positives"] as const) { const v = c?.[f]; if (typeof v === "number") m[`${ch}.${f}`] = (m[`${ch}.${f}`] ?? 0) + v; }
  }
  return json({ ok: report.some((r) => r.ok), report: q.get("debug") === "1" ? report : report.map(({ debug: _d, ...r }) => r), stored: { days: days.length, first: days[0], last: days[days.length - 1], byMonth } });
}
