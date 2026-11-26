import { readDeals, saveDeal, cleanDeal } from "@/lib/deals";
import { json, fail, personOr401, readJson } from "@/lib/api";

// The deal pop-ups: what the team added to each deal (stage, checks, to-dos, notes, links, comments, history).
export async function GET() {
  const u = await personOr401(); if (u instanceof Response) return u;
  return json(await readDeals());
}

// One deal at a time: { name, deal: { st, p, money, want, like, note, todos, links, comments, hist } }
export async function POST(req: Request) {
  const u = await personOr401(); if (u instanceof Response) return u;
  const b = await readJson(req); if (!b) return fail("Send JSON");
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 200) : "";
  if (!name) return fail("name is the deal's name");
  if (!b.deal || typeof b.deal !== "object" || Array.isArray(b.deal)) return fail("deal must be an object");
  const all = await saveDeal(name, cleanDeal(b.deal as Record<string, unknown>), u.email);
  return json({ ok: true, deal: all[name] });
}
