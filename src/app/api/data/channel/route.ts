import { updateDoc, setDay, cleanValues, isDate, isChannel, addLog, todayInSV } from "@/lib/store";
import { json, fail, personOr401, readJson } from "@/lib/api";

// Update numbers, from the Outbound channel cards: today's numbers for one channel, plus its next three months.
export async function POST(req: Request) {
  const u = await personOr401(); if (u instanceof Response) return u;
  const b = await readJson(req); if (!b) return fail("Send JSON");
  const date = b.date ?? todayInSV();
  if (!isDate(date)) return fail("date must look like 2026-11-25");
  if (date > todayInSV()) return fail("That date hasn't happened yet");
  if (!isChannel(b.channel)) return fail("channel must be ScaledMail, Mailin, Explee or MCC");
  const { vals, errors } = cleanValues(b, true);
  if (errors.length) return fail(errors.join("; "));
  const pj = b.projections as Record<string, { e: unknown; r: unknown }> | undefined;
  const months: Record<string, { e: number | null; r: number | null }> = {};
  if (pj && typeof pj === "object") for (const mk of ["nov", "dec", "jan", "feb"]) {
    const p = pj[mk]; if (!p) continue;
    const ok = (v: unknown, min: number) => v == null || (typeof v === "number" && Number.isInteger(v) && v >= min);
    if (!ok(p.e, 0) || !ok(p.r, 1)) return fail(`${mk}: emails must be 0 or more, ratio 1 or more`);
    months[mk] = { e: (p.e as number) ?? null, r: (p.r as number) ?? null };
  }
  const hasCr = "close_rate" in b, cr = b.close_rate;
  if (hasCr && cr !== null && !(typeof cr === "number" && cr > 0 && cr <= 100)) return fail("Client rate must be a percent above 0 and up to 100");
  const ch = b.channel;
  const doc = await updateDoc((doc) => {
    setDay(doc, date, ch, vals, "manual:" + u.email);
    if (Object.keys(months).length) doc.projections[ch] = { ...(doc.projections[ch] ?? {}), ...months };
    if (hasCr) doc.close_rate = cr === null ? null : Math.round((cr as number) * 100) / 100;
    addLog(doc, u.email, `updated ${ch} for ${date}`);
  });
  return json(doc);
}
