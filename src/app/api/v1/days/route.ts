import { readDoc, updateDoc, setDay, cleanValues, isDate, isChannel, addLog, todayInSV, CHANNELS, type Doc } from "@/lib/store";
import { json, fail, botOk, readJson } from "@/lib/api";

const MAX_ROWS = 500;

export async function GET(req: Request) {
  if (!botOk(req)) return fail("Send Authorization: Bearer <GLIDE_API_TOKEN>", 401);
  const q = new URL(req.url).searchParams, from = q.get("from") ?? "0000", to = q.get("to") ?? "9999", ch = q.get("channel");
  if (ch && !isChannel(ch)) return fail("channel must be one of " + CHANNELS.join(", "));
  const doc = await readDoc(), days: Doc["days"] = {};
  for (const d of Object.keys(doc.days).sort()) {
    if (d < from || d > to) continue;
    days[d] = ch ? { [ch]: doc.days[d][ch as (typeof CHANNELS)[number]] } : doc.days[d];
  }
  return json({ days, projections: doc.projections, sync: doc.sync, updated_at: doc.updated_at });
}

export async function POST(req: Request) {
  if (!botOk(req)) return fail("Send Authorization: Bearer <GLIDE_API_TOKEN>", 401);
  const body = await readJson(req); if (!body) return fail("Send JSON: { days: [ { date, channel, sent, ... } ] }");
  const rows = (Array.isArray(body.days) ? body.days : body.date ? [body] : []) as Record<string, unknown>[];
  if (!rows.length) return fail("No rows. Send { days: [ { date, channel, ... } ] }");
  if (rows.length > MAX_ROWS) return fail(`Up to ${MAX_ROWS} rows at a time`);
  const today = todayInSV(), errors: { row: number; error: string }[] = [], good: { date: string; channel: (typeof CHANNELS)[number]; vals: ReturnType<typeof cleanValues> ; note?: string }[] = [];
  rows.forEach((r, i) => {
    if (!r || typeof r !== "object") return errors.push({ row: i, error: "Each row must be an object" });
    if (!isDate(r.date)) return errors.push({ row: i, error: "date must look like 2026-11-25" });
    if (r.date > today) return errors.push({ row: i, error: `${r.date} hasn't happened yet (today is ${today} in El Salvador)` });
    if (r.date < "2026-01-01") return errors.push({ row: i, error: "Dates start in 2026" });
    if (!isChannel(r.channel)) return errors.push({ row: i, error: "channel must be one of " + CHANNELS.join(", ") });
    const v = cleanValues(r);
    if (v.errors.length) return errors.push({ row: i, error: v.errors.join("; ") });
    if (!Object.keys(v.vals).length && v.split === undefined) return errors.push({ row: i, error: "No fields to save" });
    good.push({ date: r.date, channel: r.channel, vals: v, note: typeof r.note === "string" ? r.note.slice(0, 200) : undefined });
  });
  if (errors.length && !good.length) return fail("Nothing saved", 400, { errors });
  await updateDoc((doc) => {
    for (const g of good) { setDay(doc, g.date, g.channel, g.vals.vals, "grokbot", g.vals.split); if (g.note) doc.days[g.date][g.channel]!.note = g.note; }
    addLog(doc, "grokbot", `saved ${good.length} row${good.length === 1 ? "" : "s"}`);
  });
  return json({ saved: good.length, errors });
}
