import { get, put } from "@vercel/blob";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// The Plan tab (tasks, milestones, decisions, payments, status updates), saved whole per area.
// Each save names the version it started from. If someone saved in between, the save is refused and the app reloads theirs,
// so nobody's change is silently erased.
const KEY = "glide/plan.json";
const LOCAL = path.join(process.cwd(), ".data", "plan.json");
const blobOn = () => !!process.env.BLOB_READ_WRITE_TOKEN;
export const SCOPES = ["sales"] as const;
export type PlanStore = Record<string, { v: number; data: Record<string, unknown>; updated_at: string; updated_by: string }>;

export async function readPlan(): Promise<PlanStore> {
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
export async function writePlan(p: PlanStore) {
  const body = JSON.stringify(p);
  if (!blobOn()) { await mkdir(path.dirname(LOCAL), { recursive: true }); await writeFile(LOCAL, body); return; }
  await put(KEY, body, { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 });
  const day = new Date().toISOString().slice(0, 10);
  await put(`glide/backups/plan-${day}.json`, body, { access: "private", allowOverwrite: false, addRandomSuffix: false, contentType: "application/json" }).catch(() => {});
}
// What the Plan keeps. Everything else (filters, open menus, selection) stays in the browser.
export const PLAN_FIELDS = ["tasks", "items", "deps", "iseq", "pay", "ups", "seq", "health"];
