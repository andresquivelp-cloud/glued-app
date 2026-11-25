import { updateDoc, setDay, cleanValues, isDate, isChannel, addLog, CHANNELS } from "@/lib/store";
import { json, fail, personOr401, readJson } from "@/lib/api";

// The very first load: what the Q4 files know, so the store doesn't start empty. Does nothing once any day is stored.
export async function POST(req: Request) {
  const u = await personOr401(); if (u instanceof Response) return u;
  const body = await readJson(req); if (!body) return fail("Send JSON");
  const doc = await updateDoc((doc) => {
    if (Object.keys(doc.days).length) return;
    for (const row of Array.isArray(body.days) ? (body.days as Record<string, unknown>[]) : []) {
      if (!isDate(row.date) || !isChannel(row.channel)) continue;
      const { vals, errors } = cleanValues(row); if (!errors.length) setDay(doc, row.date, row.channel, vals, "q4-files");
    }
    const pj = body.projections as Record<string, Record<string, { e: number | null; r: number | null }>> | undefined;
    if (pj) for (const ch of CHANNELS) if (pj[ch] && !doc.projections[ch]) doc.projections[ch] = pj[ch];
    addLog(doc, u.email, "seeded from the Q4 files");
  });
  return json(doc);
}
