import { get, put } from "@vercel/blob";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// What the team adds to a deal in its pop-up: stage, checks, to-dos, notes, links, comments, history.
// Kept in its own file so the hourly Smartlead/Explee sync (which rewrites sales-daily.json) never overwrites it.
const KEY = "glide/deals.json";
const LOCAL = path.join(process.cwd(), ".data", "deals.json");
const blobOn = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export type Todo = { t: string; done: 0 | 1; who?: string; due?: string | null };
export type Link = { u: string; n?: string; at: string; who?: string };
export type Comment = { who: string; n?: string; at: string; t: string };
export type Hist = { at: string; who?: string; what: string };
export type Deal = {
  st?: string; p?: number; money?: 0 | 1; want?: 0 | 1; like?: 0 | 1; note?: string;
  todos?: Todo[]; links?: Link[]; comments?: Comment[]; hist?: Hist[]; updated_at?: string; updated_by?: string;
};
export type Deals = Record<string, Deal>;

export async function readDeals(): Promise<Deals> {
  try {
    if (!blobOn()) return JSON.parse(await readFile(LOCAL, "utf8"));
    const r = await get(KEY, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return {};
    return JSON.parse(await new Response(r.stream).text());
  } catch (e) {
    if (/NotFound|ENOENT|not found/i.test(String((e as { name?: string })?.name ?? "") + String(e))) return {};
    throw e;
  }
}

async function writeDeals(d: Deals) {
  const body = JSON.stringify(d);
  if (!blobOn()) { await mkdir(path.dirname(LOCAL), { recursive: true }); await writeFile(LOCAL, body); return; }
  await put(KEY, body, { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 });
  const day = new Date().toISOString().slice(0, 10);
  await put(`glide/backups/deals-${day}.json`, body, { access: "private", allowOverwrite: false, addRandomSuffix: false, contentType: "application/json" }).catch(() => {});
}

const STAGES = ["Positive reply", "Call booked", "Proposal", "Final approval", "Won"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const bit = (v: unknown) => (v ? 1 : 0) as 0 | 1;
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v.slice(0, 40) : new Date().toISOString());
const list = <T>(v: unknown, max: number, f: (x: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(v) ? v.slice(0, max).map((x) => (x && typeof x === "object" ? f(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null) : [];
const okUrl = (u: unknown) => { if (typeof u !== "string") return null; try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.toString().slice(0, 2000) : null; } catch { return null; } };

// Only the fields the pop-up writes, in the sizes it needs. Anything else is dropped.
export function cleanDeal(b: Record<string, unknown>): Deal {
  const d: Deal = {};
  if (typeof b.st === "string" && STAGES.includes(b.st)) d.st = b.st;
  if (typeof b.p === "number" && b.p >= 0 && b.p <= 100) d.p = Math.round(b.p);
  for (const k of ["money", "want", "like"] as const) if (k in b) d[k] = bit(b[k]);
  if ("note" in b) d.note = str(b.note, 20000) ?? "";
  if ("todos" in b) d.todos = list(b.todos, 200, (x) => { const t = str(x.t, 500); return t ? { t, done: bit(x.done), who: str(x.who, 40), due: typeof x.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.due) ? x.due : null } : null; });
  if ("links" in b) d.links = list(b.links, 100, (x) => { const u = okUrl(x.u); return u ? { u, n: str(x.n, 200) ?? "", at: iso(x.at), who: str(x.who, 40) } : null; });
  if ("comments" in b) d.comments = list(b.comments, 500, (x) => { const t = str(x.t, 10000); return t ? { who: str(x.who, 40) ?? "", n: str(x.n, 80), at: iso(x.at), t } : null; });
  if ("hist" in b) d.hist = list(b.hist, 500, (x) => { const w = str(x.what, 500); return w ? { at: iso(x.at), who: str(x.who, 40), what: w } : null; });
  return d;
}

export async function saveDeal(name: string, deal: Deal, by: string): Promise<Deals> {
  const all = await readDeals();
  all[name] = { ...(all[name] ?? {}), ...deal, updated_at: new Date().toISOString(), updated_by: by };
  await writeDeals(all);
  return all;
}
