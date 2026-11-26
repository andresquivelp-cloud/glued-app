import { readDoc, updateDoc, isChannel, CHANNELS, addLog } from "@/lib/store";
import { json, fail, botOk, readJson } from "@/lib/api";

const NEED = "Send Authorization: Bearer <GLIDE_API_TOKEN>", MONTHS = ["dec", "jan", "feb"];
// Each channel's plan for the next months (the Capacity tab's "Edit plan"): emails to send and emails per positive reply
export async function GET(req: Request) {
  if (!botOk(req)) return fail(NEED, 401);
  return json({ projections: (await readDoc()).projections, months: MONTHS });
}
// { rows: [ { channel, month: "dec", emails: 120000, ratio: 600 } ] }. null clears a number (the app then uses the healthy capacity / this quarter's ratio)
export async function POST(req: Request) {
  if (!botOk(req)) return fail(NEED, 401);
  const b = await readJson(req); const rows = (Array.isArray(b?.rows) ? b!.rows : b?.channel ? [b] : []) as Record<string, unknown>[];
  if (!rows.length) return fail("Send { rows: [ { channel, month, emails, ratio } ] }");
  const errors: string[] = [];
  rows.forEach((r, i) => {
    if (!isChannel(r.channel)) errors.push(`row ${i}: channel must be ${CHANNELS.join(", ")}`);
    if (!MONTHS.includes(String(r.month))) errors.push(`row ${i}: month must be dec, jan or feb`);
    const ok = (v: unknown, min: number) => v === undefined || v === null || (typeof v === "number" && Number.isInteger(v) && v >= min);
    if (!ok(r.emails, 0)) errors.push(`row ${i}: emails must be a whole number, 0 or more, or null`);
    if (!ok(r.ratio, 1)) errors.push(`row ${i}: ratio must be a whole number, 1 or more, or null`);
  });
  if (errors.length) return fail(errors.join("; "));
  const doc = await updateDoc((doc) => {
    for (const r of rows) { const ch = r.channel as (typeof CHANNELS)[number], m = String(r.month), cur = doc.projections[ch]?.[m] ?? { e: null, r: null };
      doc.projections[ch] = { ...(doc.projections[ch] ?? {}), [m]: { e: r.emails === undefined ? cur.e : (r.emails as number | null), r: r.ratio === undefined ? cur.r : (r.ratio as number | null) } }; }
    addLog(doc, "grokbot", `projections: ${rows.length} rows`);
  });
  return json({ ok: true, projections: doc.projections });
}
