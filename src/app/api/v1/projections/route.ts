import { readDoc, updateDoc, isChannel, CHANNELS, addLog } from "@/lib/store";
import { json, fail, botOk, readJson } from "@/lib/api";

const NEED = "Send Authorization: Bearer <GLIDE_API_TOKEN>", MONTHS = ["nov", "dec", "jan", "feb"];
// Each channel's plan for the next months (the Capacity tab's "Edit plan"): emails to send and emails per positive reply
export async function GET(req: Request) {
  if (!botOk(req)) return fail(NEED, 401);
  const doc = await readDoc();
  return json({ projections: doc.projections, close_rate: doc.close_rate ?? null, months: MONTHS });
}
// { rows: [ { channel, month: "dec", emails: 120000, ratio: 600 } ], close_rate: 1.5 }. null clears a number (the app then uses the healthy capacity / the last 30 days' rates).
// close_rate is the % of leads that become clients, for every channel and month
export async function POST(req: Request) {
  if (!botOk(req)) return fail(NEED, 401);
  const b = await readJson(req); const rows = (Array.isArray(b?.rows) ? b!.rows : b?.channel ? [b] : []) as Record<string, unknown>[];
  const hasCr = b !== null && typeof b === "object" && "close_rate" in b, cr = hasCr ? (b as Record<string, unknown>).close_rate : undefined;
  if (!rows.length && !hasCr) return fail("Send { rows: [ { channel, month, emails, ratio } ], close_rate }");
  const errors: string[] = [];
  if (hasCr && cr !== null && !(typeof cr === "number" && cr > 0 && cr <= 100)) errors.push("close_rate must be a percent above 0 and up to 100 (1.5 means 1.5%), or null");
  rows.forEach((r, i) => {
    if (!isChannel(r.channel)) errors.push(`row ${i}: channel must be ${CHANNELS.join(", ")}`);
    if (!MONTHS.includes(String(r.month))) errors.push(`row ${i}: month must be nov, dec, jan or feb`);
    const ok = (v: unknown, min: number) => v === undefined || v === null || (typeof v === "number" && Number.isInteger(v) && v >= min);
    if (!ok(r.emails, 0)) errors.push(`row ${i}: emails must be a whole number, 0 or more, or null`);
    if (!ok(r.ratio, 1)) errors.push(`row ${i}: ratio must be a whole number, 1 or more, or null`);
  });
  if (errors.length) return fail(errors.join("; "));
  const doc = await updateDoc((doc) => {
    for (const r of rows) { const ch = r.channel as (typeof CHANNELS)[number], m = String(r.month), cur = doc.projections[ch]?.[m] ?? { e: null, r: null };
      doc.projections[ch] = { ...(doc.projections[ch] ?? {}), [m]: { e: r.emails === undefined ? cur.e : (r.emails as number | null), r: r.ratio === undefined ? cur.r : (r.ratio as number | null) } }; }
    if (hasCr) doc.close_rate = cr === null ? null : Math.round((cr as number) * 100) / 100;
    addLog(doc, "grokbot", `projections: ${rows.length} rows${hasCr ? `, close rate ${cr === null ? "cleared" : cr + "%"}` : ""}`);
  });
  return json({ ok: true, projections: doc.projections, close_rate: doc.close_rate ?? null });
}
