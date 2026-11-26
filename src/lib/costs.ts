import { get, put } from "@vercel/blob";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { OpError } from "./deals";

// Sales costs by month: tools, inboxes, domains, lead data. No team pay (the app is shared with the sales team).
// The app sends the cost sheet once from its sealed bundle; after that Grokbot (or anyone with the token) keeps it up to date here.
const KEY = "glide/costs.json";
const LOCAL = path.join(process.cwd(), ".data", "costs.json");
const blobOn = () => !!process.env.BLOB_READ_WRITE_TOKEN;
export type Cost = { id: string; month: string; brand: "Glued" | "Digital Socios" | "shared"; category: string; item: string; amount: number | null;
  type: "actual" | "estimated" | "projected"; status: "" | "failed" | "unpaid" | "unknown" | "receipt"; note: string; updated_at: string; by: string };
export type CostStore = { rows: Cost[]; updated_at: string | null };

export async function readCosts(): Promise<CostStore> {
  try {
    if (!blobOn()) return JSON.parse(await readFile(LOCAL, "utf8"));
    const r = await get(KEY, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return { rows: [], updated_at: null };
    return JSON.parse(await new Response(r.stream).text());
  } catch (e) {
    if (/NotFound|ENOENT|not found/i.test(String((e as { name?: string })?.name ?? "") + String(e))) return { rows: [], updated_at: null };
    throw e;
  }
}
async function writeCosts(c: CostStore) {
  c.updated_at = new Date().toISOString(); const body = JSON.stringify(c);
  if (!blobOn()) { await mkdir(path.dirname(LOCAL), { recursive: true }); await writeFile(LOCAL, body); return; }
  await put(KEY, body, { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 });
}
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const brandOf = (v: unknown) => { const b = String(v ?? "").toLowerCase(); return b === "1" || b.startsWith("g") ? "Glued" : b === "2" || b.startsWith("d") ? "Digital Socios" : b === "" || b === "0" || b.startsWith("s") || b === "both" ? "shared" : null; };

export function cleanCost(r: Record<string, unknown>, i: number, by: string): Cost | string {
  const month = str(r.month, 7); if (!/^\d{4}-\d{2}$/.test(month)) return `row ${i}: month must look like 2026-12`;
  const brand = brandOf(r.brand); if (!brand) return `row ${i}: brand must be Glued, Digital Socios or shared`;
  const item = str(r.item, 200); if (!item) return `row ${i}: item is required`;
  const amount = r.amount === null || r.amount === undefined || r.amount === "" ? null : Number(r.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1e7)) return `row ${i}: amount must be dollars, 0 or more, or null when the price is not known`;
  const type = (["actual", "estimated", "projected"] as const).find((t) => t === r.type) ?? "actual";
  const status = (["", "failed", "unpaid", "unknown", "receipt"] as const).find((t) => t === (r.status ?? "")) ?? null;
  if (status === null) return `row ${i}: status must be "", failed, unpaid, unknown or receipt`;
  const category = str(r.category, 60) || "Other";
  if (/payroll|salary|pay\b/i.test(category + " " + item)) return `row ${i}: team pay stays out of this app`;
  return { id: str(r.id, 60) || "c-" + hash(`${month}|${brand}|${category}|${item}|${r.amount ?? ""}`), month, brand, category, item, amount: amount === null ? null : Math.round(amount * 100) / 100, type, status: amount === null ? "unknown" : status, note: str(r.note, 300), updated_at: new Date().toISOString(), by };
}

// add or update lines (same id, or same month + brand + category + item), and remove by id
export async function changeCosts(rows: unknown, remove: unknown, by: string, onlyIfEmpty = false) {
  const store = await readCosts();
  if (onlyIfEmpty && store.rows.length) return { added: 0, updated: 0, removed: 0, store };
  const add = Array.isArray(rows) ? rows : [], del = Array.isArray(remove) ? remove.map(String) : [];
  if (add.length > 500) throw new OpError("Up to 500 rows at a time");
  const clean: Cost[] = [], errors: string[] = [];
  add.forEach((r, i) => { const c = r && typeof r === "object" ? cleanCost(r as Record<string, unknown>, i, by) : `row ${i}: must be an object`; if (typeof c === "string") errors.push(c); else clean.push(c); });
  if (errors.length) throw new OpError(errors.slice(0, 20).join("; "));
  let added = 0, updated = 0;
  for (const c of clean) { const i = store.rows.findIndex((x) => x.id === c.id); if (i >= 0) { store.rows[i] = c; updated++; } else { store.rows.push(c); added++; } }
  const before = store.rows.length; store.rows = store.rows.filter((x) => !del.includes(x.id)); const removed = before - store.rows.length;
  store.rows.sort((a, b) => a.month.localeCompare(b.month) || a.brand.localeCompare(b.brand) || a.category.localeCompare(b.category));
  if (added || updated || removed) await writeCosts(store);
  return { added, updated, removed, store };
}
