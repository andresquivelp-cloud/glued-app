import { get, put } from "@vercel/blob";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// One JSON document in the private Blob store holds every day of Sales numbers.
// days["2026-11-25"]["ScaledMail"] = { sent, positives, calls, real_capacity, total_capacity, burnt_inboxes, ratio, by_brand, src, updated_at }

export const CHANNELS = ["ScaledMail", "Mailin", "Explee", "MCC"] as const;
export type Channel = (typeof CHANNELS)[number];
export const FLOW = ["sent", "replies", "positives", "calls", "bounced"] as const;            // what happened that day
export const STATE = ["real_capacity", "total_capacity", "burnt_inboxes", "ratio", "inboxes", "inboxes_google", "inboxes_outlook", "inboxes_other", "daily_limit"] as const;  // how things stood that day
export const FIELDS = [...FLOW, ...STATE] as const;
export type Field = (typeof FIELDS)[number];

export type BrandSplit = { glued?: Partial<Record<(typeof FLOW)[number], number>>; ds?: Partial<Record<(typeof FLOW)[number], number>> };
export type DayChannel = Partial<Record<Field, number>> & { by_brand?: BrandSplit; src?: Partial<Record<Field, string>>; updated_at?: string; note?: string };
export type Projection = { e: number | null; r: number | null };
/* a positive reply from Smartlead or Explee, added to the Pipeline as a Cold deal for Daniel */
export type Lead = { id: string; n: string; person: string; email: string; title?: string; company: string; domain?: string; b: 1 | 2; source: "Smartlead" | "Explee";
  campaign: string; reply: string; at: string; st: string; p: number; who: string; t: string; v: number; step: string; due: string; added: string };
export type Doc = {
  version: 1;
  days: Record<string, Partial<Record<Channel, DayChannel>>>;
  projections: Partial<Record<Channel, Record<string, Projection>>>;
  sync: Record<string, { at: string; ok: boolean; msg: string; backfilled_from?: string }>;
  log: { at: string; who: string; what: string }[];
  leads: Lead[];
  updated_at: string | null;
};

const KEY = "glide/sales-daily.json";
const LOCAL = path.join(process.cwd(), ".data", "sales-daily.json");
const blobOn = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export const emptyDoc = (): Doc => ({ version: 1, days: {}, projections: {}, sync: {}, log: [], leads: [], updated_at: null });

export async function readDoc(): Promise<Doc> { return (await readWithTag()).doc; }

async function readWithTag(): Promise<{ doc: Doc; etag: string | null }> {
  try {
    if (!blobOn()) return { doc: { ...emptyDoc(), ...JSON.parse(await readFile(LOCAL, "utf8")) }, etag: null };
    const r = await get(KEY, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return { doc: emptyDoc(), etag: null };
    const text = await new Response(r.stream).text();
    return { doc: { ...emptyDoc(), ...JSON.parse(text) }, etag: r.blob.etag };
  } catch (e) {
    if (isNotFound(e)) return { doc: emptyDoc(), etag: null };
    throw e;
  }
}

// Read, change, write. Last write wins: the Blob etag check refused every write in production (ETag mismatch), so it is off.
export async function updateDoc(change: (doc: Doc) => void | Promise<void>): Promise<Doc> {
  const { doc } = await readWithTag();
  await change(doc);
  await writeDoc(doc);
  return doc;
}

function isNotFound(e: unknown) {
  const s = String((e as { name?: string; code?: string })?.name ?? "") + String((e as { code?: string })?.code ?? "") + String(e);
  return /NotFound|ENOENT|not found/i.test(s);
}

async function writeDoc(doc: Doc) {
  doc.updated_at = new Date().toISOString();
  doc.log = doc.log.slice(-300);
  const body = JSON.stringify(doc);
  if (!blobOn()) { await mkdir(path.dirname(LOCAL), { recursive: true }); await writeFile(LOCAL, body); return; }
  await put(KEY, body, { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 });
  // one backup a day, kept as it was at the day's first write
  const day = doc.updated_at.slice(0, 10);
  await put(`glide/backups/${day}.json`, body, { access: "private", allowOverwrite: false, addRandomSuffix: false, contentType: "application/json" }).catch(() => {});
}

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
export const isChannel = (s: unknown): s is Channel => typeof s === "string" && (CHANNELS as readonly string[]).includes(s);

// Merge values into one day and channel. A number sets the field, null clears it, anything missing is left alone.
export function setDay(doc: Doc, date: string, ch: Channel, vals: Partial<Record<Field, number | null>>, source: string, split?: BrandSplit | null) {
  const day = (doc.days[date] ??= {});
  const c: DayChannel = (day[ch] ??= {});
  c.src ??= {};
  for (const f of FIELDS) {
    if (!(f in vals)) continue;
    const v = vals[f];
    if (v === null || v === undefined) { delete c[f]; delete c.src[f]; }
    else { c[f] = v; c.src[f] = source; }
  }
  if (split !== undefined) { if (split === null) delete c.by_brand; else c.by_brand = split; }
  c.updated_at = new Date().toISOString();
}

export const todayInSV = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/El_Salvador" }).format(new Date());

// Checks one incoming row. Flows may be negative only when a person corrects a month total by hand.
export function cleanValues(row: Record<string, unknown>, allowNegativeFlow = false) {
  const vals: Partial<Record<Field, number | null>> = {}, errors: string[] = [];
  for (const f of FIELDS) {
    if (!(f in row)) continue;
    const v = row[f];
    if (v === null) { vals[f] = null; continue; }
    if (typeof v !== "number" || !Number.isFinite(v) || Math.round(v) !== v) { errors.push(`${f} must be a whole number or null`); continue; }
    if (v < 0 && !(allowNegativeFlow && (FLOW as readonly string[]).includes(f))) { errors.push(`${f} can't be negative`); continue; }
    if (f === "ratio" && v === 0) { errors.push("ratio must be 1 or more, or null"); continue; }
    vals[f] = v;
  }
  let split: BrandSplit | null | undefined;
  if ("by_brand" in row) {
    const b = row.by_brand as Record<string, Record<string, unknown>> | null;
    if (b === null) split = null;
    else if (typeof b !== "object") errors.push("by_brand must be an object like { glued: { sent }, ds: { sent } }");
    else {
      split = {};
      for (const brand of ["glued", "ds"] as const) {
        const x = b[brand]; if (!x) continue; const o: Record<string, number> = {};
        for (const f of FLOW) { const v = x[f]; if (v === undefined) continue; if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || Math.round(v) !== v) errors.push(`by_brand.${brand}.${f} must be a whole number, 0 or more`); else o[f] = v; }
        split[brand] = o;
      }
    }
  }
  return { vals, split, errors };
}

export function addLog(doc: Doc, who: string, what: string) {
  doc.log.push({ at: new Date().toISOString(), who, what });
}
