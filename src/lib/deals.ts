import { get, put } from "@vercel/blob";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { readDoc, type Lead } from "./store";

// The Pipeline, on the server. Two files make one list:
//   1. sales-daily.json leads: positive replies the Smartlead/Explee sync added
//   2. deals.json: deals added in the app or by Grokbot (and the ones from before launch), plus everything anyone changed on any deal
// deals.json is its own file so the hourly sync (which rewrites sales-daily.json) never overwrites a deal edit.
// Every change is an operation applied to what is stored right now, so two people (or Grokbot) editing the same deal don't erase each other.

const KEY = "glide/deals.json";
const LOCAL = path.join(process.cwd(), ".data", "deals.json");
const blobOn = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export const STAGES = ["Positive reply", "Call booked", "Proposal", "Final approval", "Won"] as const;
// Nov 26: board-only columns between Positive reply and Call booked. The deal's stage stays Positive reply while it sits in one
export const LANES = ["Prepping assets", "Assets ready", "In follow-ups"] as const;
export const OWNERS: Record<string, string> = { andres: "Andrés", david: "David Arrué", dan: "Daniel", grok: "Grokbot" };
const CHECKS = ["money", "want", "like"] as const;
type Check = (typeof CHECKS)[number];

export type Base = {
  n: string; b: 1 | 2; st: string; v: number; p: number; who: string; step: string; due: string | null; t?: string;
  person?: string; email?: string; title?: string; company?: string; domain?: string; source?: string; campaign?: string; reply?: string; at?: string; added?: string; id?: string;
  thread?: Msg[];
};
export type Msg = { id?: string; at: string; dir: "in" | "out"; subject?: string; body: string; src: string; from?: string; to?: string };
export type Todo = { id: string; t: string; done: 0 | 1; who?: string; due?: string | null };
export type Link = { id: string; u: string; n?: string; at: string; who?: string };
export type Comment = { id: string; who: string; at: string; t: string };
export type Hist = { at: string; who?: string; what: string };
export type Stored = {
  base?: Base;                                       // only for deals added in the app or by Grokbot
  st?: string; p?: number; v?: number; who?: string; step?: string; due?: string | null; lane?: string | null; b?: 1 | 2;
  person?: string; title?: string; company?: string; email?: string; website?: string; thread?: Msg[];
  money?: 0 | 1; want?: 0 | 1; like?: 0 | 1; note?: string;
  todos?: Todo[]; links?: Link[]; comments?: Comment[]; hist?: Hist[]; updated_at?: string; updated_by?: string;
};
export type Stores = Record<string, Stored>;

// The deals that were in the pipeline before the app went live are not in this (public) code: the app sends them once,
// from its sealed bundle, and they are kept in deals.json as a base like any deal added later (seedBases).

/* ---------- reading and writing deals.json */
export async function readStores(): Promise<Stores> {
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
async function writeStores(d: Stores) {
  const body = JSON.stringify(d);
  if (!blobOn()) { await mkdir(path.dirname(LOCAL), { recursive: true }); await writeFile(LOCAL, body); return; }
  await put(KEY, body, { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 });
  const day = new Date().toISOString().slice(0, 10);
  await put(`glide/backups/deals-${day}.json`, body, { access: "private", allowOverwrite: false, addRandomSuffix: false, contentType: "application/json" }).catch(() => {});
}

/* ---------- the merged list */
const leadBase = (l: Lead): Base => ({ ...(l as unknown as Base), n: l.n });
export async function allBases(stores?: Stores): Promise<Base[]> {
  const s = stores ?? (await readStores()), doc = await readDoc(), out: Base[] = [], seen = new Set<string>();
  for (const [n, x] of Object.entries(s)) if (x.base && !seen.has(n)) { out.push({ ...x.base, n }); seen.add(n); }
  for (const l of doc.leads ?? []) if (!seen.has(l.n)) { out.push(leadBase(l)); seen.add(l.n); }
  return out;
}
const TODO_BY_STAGE: Record<string, string[]> = {
  "Positive reply": ["Reply within 24 hours", "Book a call", "Send the one-pager"],
  "Call booked": ["Prep for the call", "Send a recap after the call"],
  Proposal: ["Send the proposal", "Follow up in 3 days"],
  "Final approval": ["Send the contract", "Collect the kickoff payment"],
  Won: ["Hand off to delivery"],
};
// The same first to-dos and history the pop-up shows (pl_modal.js plmSeed), so the app and Grokbot see one list.
function seedTodos(d: Base, st: string): Todo[] {
  const base = TODO_BY_STAGE[st] ?? [], first = d.step && !base.some((x) => x.toLowerCase() === d.step.toLowerCase()) && st !== "Positive reply" ? [d.step] : [];
  return first.concat(base).map((t, i) => ({ id: "seed-" + i, t, done: 0, who: d.who,
    due: st === "Positive reply" ? (t === "Book a call" ? d.due : t.startsWith("Reply") && d.at ? d.at.slice(0, 10) : null) : i === 0 ? d.due : null }));
}
function seedHist(d: Base, st: string): Hist[] {
  const h: Hist[] = [];
  if (d.at) h.push({ at: d.at, who: "", what: `Positive reply came in on ${d.source || "email"}${d.campaign ? " · " + d.campaign : ""}` });
  h.push({ at: d.added || "2026-11-25", who: d.added ? "" : "andres", what: d.added ? `Added to the Pipeline by the ${d.source || ""} sync as ${st}, Cold, for ${OWNERS[d.who] || d.who}` : `Deal added at ${st}` });
  return h;
}
const checksOf = (d: Base, s: Stored) => {
  const t = d.t || "Cold", def = { money: t === "Hot" ? 1 : 0, want: t !== "Cold" ? 1 : 0, like: d.source ? 0 : 1 } as Record<Check, 0 | 1>;
  if (d.source) def.money = def.want = 0;
  return Object.fromEntries(CHECKS.map((k) => [k, (s[k] ?? def[k]) ? 1 : 0])) as Record<Check, 0 | 1>;
};
const idOk = (x: unknown) => typeof x === "string" && /^[\w-]{1,40}$/.test(x);
// Older saves had no ids on to-dos, links and comments: give them stable ones.
function normalize(s: Stored) {
  s.todos?.forEach((x, i) => { if (!idOk(x.id)) x.id = "seed-" + i; });
  s.links?.forEach((x, i) => { if (!idOk(x.id)) x.id = "l" + i; });
  s.comments?.forEach((x, i) => { if (!idOk(x.id)) x.id = "c" + i; });
  return s;
}

/* ---------- what the API shows for one deal */
export function view(d: Base, s0: Stored | undefined) {
  const s = normalize(structuredClone(s0 ?? {})), st = s.st ?? d.st, ck = checksOf(d, s), n = CHECKS.filter((k) => ck[k]).length, b = s.b ?? d.b;
  const v = s.v ?? d.v, p = s.p ?? d.p, who = s.who ?? d.who;
  return {
    name: d.n, brand: b === 1 ? "Glued" : "Digital Socios", stage: st, board_column: st === "Positive reply" ? (s.lane ?? "Positive reply") : st, value: v, probability: p, weighted: Math.round((v * p) / 100),
    owner: who, owner_name: OWNERS[who] ?? who, next_step: s.step ?? d.step ?? "", next_step_due: s.due !== undefined ? s.due : d.due ?? null,
    temperature: n === 3 ? "Hot" : n === 2 ? "Warm" : "Cold", checks: { has_money: !!ck.money, wants_project: !!ck.want, likes_us: !!ck.like },
    contact: { person: s.person ?? d.person ?? null, title: s.title ?? d.title ?? null, email: s.email ?? d.email ?? null, company: s.company ?? d.company ?? null, website: s.website ?? d.domain ?? null },
    source: d.source ?? null, campaign: d.campaign ?? null, their_reply: d.reply ?? null, replied_at: d.at ?? null, added_at: d.added ?? null,
    note: s.note ?? "",
    todos: (s.todos ?? seedTodos(d, st)).map((x) => ({ id: x.id, text: x.t, done: !!x.done, owner: x.who ?? null, due: x.due ?? null })),
    links: (s.links ?? []).map((x) => ({ id: x.id, url: x.u, name: x.n ?? "", added_at: x.at, added_by: x.who ?? null })),
    thread: [...(d.thread ?? []), ...(s.thread ?? [])].sort((x, y) => x.at.localeCompare(y.at)).map((m) => ({ id: m.id ?? null, at: m.at, direction: m.dir === "in" ? "from them" : "from us", source: m.src, from: m.from ?? null, to: m.to ?? null, subject: m.subject ?? "", body: m.body })),
    comments: (s.comments ?? []).map((x) => ({ id: x.id, by: x.who, at: x.at, text: x.t })),
    history: (s.hist ?? seedHist(d, st)).slice().reverse().sort((a, b) => String(b.at).localeCompare(String(a.at))).map((x) => ({ at: x.at, by: x.who || "sync", what: x.what })),
    updated_at: s.updated_at ?? null, updated_by: s.updated_by ?? null,
  };
}
export type DealView = ReturnType<typeof view>;

/* ---------- changes */
export type Op = Record<string, unknown> & { op: string };
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const day = (v: unknown) => (v == null || v === "" ? null : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const okUrl = (u: unknown) => { if (typeof u !== "string") return null; let x = u.trim(); if (!/^https?:\/\//i.test(x)) x = "https://" + x; try { const r = new URL(x); return /^https?:$/.test(r.protocol) && r.hostname.includes(".") ? r.toString().slice(0, 2000) : null; } catch { return null; } };
const newId = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const FIELDS: Record<string, keyof Stored> = { value: "v", probability: "p", owner: "who", next_step: "step", next_step_due: "due", note: "note", v: "v", p: "p", who: "who", step: "step", due: "due",
  board_column: "lane", lane: "lane", brand: "b", b: "b", person: "person", contact_name: "person", title: "title", company: "company", email: "email", website: "website" };
const CHECK_KEYS: Record<string, Check> = { money: "money", has_money: "money", want: "want", wants_project: "want", like: "like", likes_us: "like" };
const CHECK_NAME: Record<Check, string> = { money: "Has the money", want: "Wants the project", like: "Likes us" };

export class OpError extends Error {}

// Apply a list of changes to one deal. who: andres, david, dan or grok. Throws OpError with a plain message when a change can't be made.
function apply(d: Base, s: Stored, ops: Op[], who: string) {
  normalize(s);
  const now = () => new Date().toISOString(), log = (what: string) => (s.hist ??= seedHist(d, s.st ?? d.st)).push({ at: now(), who, what });
  const st = () => s.st ?? d.st;
  s.hist ??= seedHist(d, st()); s.todos ??= seedTodos(d, st());      // the first history lines and to-dos as they were before this change
  const todos = () => (s.todos ??= seedTodos(d, st())), find = <T extends { id: string }>(arr: T[], o: Op, by: (x: T) => string) => {
    const i = typeof o.id === "string" ? arr.findIndex((x) => x.id === o.id) : typeof o.text === "string" || typeof o.url === "string" ? arr.findIndex((x) => by(x).toLowerCase() === String(o.text ?? o.url).trim().toLowerCase()) : -1;
    if (i < 0) throw new OpError(`${o.op}: no item with that ${o.id ? "id" : "text"}`); return i;
  };
  for (const o of ops) {
    switch (o.op) {
      case "stage": {
        const to = STAGES.find((x) => x.toLowerCase() === String(o.stage ?? o.value ?? "").trim().toLowerCase());
        if (!to) throw new OpError(`stage must be one of: ${STAGES.join(", ")}`);
        todos(); const from = st(); if (from === to) break;
        s.st = to; if (to === "Won") s.p = 100; if (to !== "Positive reply") s.lane = null; log(`moved this deal from ${from} to ${to}`); break;
      }
      case "stage_if": {      // move only from the given stage (the calls API: Positive reply to Call booked)
        const to = STAGES.find((x) => x === o.stage), from = st();
        if (to && from === o.from) { todos(); s.st = to; log(`moved this deal from ${from} to ${to}`); }
        break;
      }
      case "set": {
        const f = FIELDS[String(o.field)]; if (!f) throw new OpError(`set: field must be value, probability, owner, next_step, next_step_due or note`);
        let v: unknown = o.value;
        if (f === "v") { if (typeof v !== "number" || v < 0 || v > 1e8) throw new OpError("value must be a number of dollars"); v = Math.round(v); }
        if (f === "p") { if (typeof v !== "number" || v < 0 || v > 100) throw new OpError("probability must be 0 to 100"); v = Math.round(v); }
        if (f === "who") { if (typeof v !== "string" || !OWNERS[v] || v === "grok") throw new OpError("owner must be andres, david or dan"); }
        if (f === "step") v = str(v, 200);
        if (f === "note") v = typeof v === "string" ? v.slice(0, 20000) : "";
        if (f === "due") { v = day(v); if (v === undefined) throw new OpError("next_step_due must look like 2026-12-01, or null"); }
        if (f === "lane") { if (v === null || v === "" || v === "Positive reply") v = null; else if (!(LANES as readonly string[]).includes(String(v))) throw new OpError(`board_column must be Positive reply, ${LANES.join(", ")}`);
          if (v && st() !== "Positive reply") { const from = st(); s.st = "Positive reply"; log(`moved this deal from ${from} to Positive reply`); } }
        if (f === "b") { const x = String(v).toLowerCase(); v = x === "1" || x.startsWith("g") ? 1 : x === "2" || x.startsWith("d") ? 2 : 0; if (!v) throw new OpError('brand must be "Glued" or "Digital Socios"'); }
        if (f === "person" || f === "title" || f === "company") v = str(v, 160);
        if (f === "website") { v = str(v, 200).replace(/^https?:\/\//i, "").replace(/\/+$/, ""); if (v && !/^[^\s/]+\.[^\s]+$/.test(v as string)) throw new OpError("website must look like acme.com"); }
        if (f === "email") { v = str(v, 200).toLowerCase(); if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v as string)) throw new OpError("email must look like name@company.com"); }
        const before = (s as Record<string, unknown>)[f] ?? (d as Record<string, unknown>)[f];
        (s as Record<string, unknown>)[f] = v;
        const LBL: Record<string, string> = { v: "the deal value", p: "the chance", who: "the owner", step: "the next step", due: "the next step date", lane: "the board column", b: "the brand", person: "the contact name", title: "the contact's title", company: "the company", email: "the contact email", website: "the website" };
        const shown = f === "who" ? OWNERS[v as string] : f === "v" ? "$" + (v as number).toLocaleString("en-US") : f === "p" ? v + "%" : f === "b" ? (v === 1 ? "Glued" : "Digital Socios") : f === "lane" ? (v ?? "Positive reply") : v || (f === "due" ? "no date" : "blank");
        if (f !== "note" && before !== v) log(`changed ${LBL[f] ?? String(o.field).replace(/_/g, " ")} to ${shown}`);
        if (f === "note" && who === "grok") log("updated the notes");
        break;
      }
      case "note_append": {
        const t = str(o.text, 10000); if (!t) throw new OpError("note_append: text is empty");
        s.note = ((s.note ?? "") + (s.note ? "\n\n" : "") + t).slice(0, 20000); log("added to the notes"); break;
      }
      case "check": {
        const k = CHECK_KEYS[String(o.key)]; if (!k) throw new OpError("check: key must be has_money, wants_project or likes_us");
        const ck = checksOf(d, s), was = CHECKS.filter((x) => ck[x]).length, on = o.on === undefined ? 1 : o.on ? 1 : 0;
        CHECKS.forEach((x) => (s[x] = ck[x])); if (s[k] === on) break; s[k] = on as 0 | 1;
        const now2 = CHECKS.filter((x) => s[x]).length, t = (n: number) => (n === 3 ? "Hot" : n === 2 ? "Warm" : "Cold");
        log(`${on ? "marked" : "unmarked"} "${CHECK_NAME[k]}"${t(was) !== t(now2) ? `, now ${t(now2)}` : ""}`); break;
      }
      case "todo_add": {
        const t = str(o.text, 500); if (!t) throw new OpError("todo_add: text is empty");
        const due = day(o.due); if (due === undefined) throw new OpError("todo_add: due must look like 2026-12-01");
        const owner = typeof o.owner === "string" && OWNERS[o.owner] ? o.owner : s.who ?? d.who;
        todos().push({ id: idOk(o.id) ? (o.id as string) : newId("t"), t, done: 0, who: owner, due }); log(`added the to-do "${t}"`); break;
      }
      case "todo_done": {
        const a = todos(), i = find(a, o, (x) => x.t), on = o.done === undefined ? 1 : o.done ? 1 : 0;
        if (a[i].done === on) break; a[i].done = on as 0 | 1; log(`${on ? "finished" : "reopened"} "${a[i].t}"`); break;
      }
      case "todo_remove": { const a = todos(), i = find(a, o, (x) => x.t), x = a.splice(i, 1)[0]; log(`removed the to-do "${x.t}"`); break; }
      case "link_add": {
        const u = okUrl(o.url); if (!u) throw new OpError("link_add: url must be a web address");
        const n = str(o.name, 200); (s.links ??= []).push({ id: idOk(o.id) ? (o.id as string) : newId("l"), u, n, at: now(), who });
        log(`attached ${n ? `"${n}"` : new URL(u).hostname.replace(/^www\./, "")}`); break;
      }
      case "link_remove": { const a = (s.links ??= []), i = find(a, o, (x) => x.u), x = a.splice(i, 1)[0]; log(`removed the link ${x.n ? `"${x.n}"` : new URL(x.u).hostname}`); break; }
      case "thread_add": {      // a message from outside Smartlead (Gmail, for example) or one Smartlead did not send us
        const body = typeof o.body === "string" ? o.body.trim().slice(0, 4000) : ""; if (!body) throw new OpError("thread_add: body is empty");
        const at = typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) ? new Date(o.at).toISOString() : null; if (!at) throw new OpError("thread_add: at must be the message's date and time");
        const dir = /^(in|from them|received)$/i.test(String(o.direction ?? o.dir ?? "")) ? "in" : /^(out|from us|sent)$/i.test(String(o.direction ?? o.dir ?? "")) ? "out" : null;
        if (!dir) throw new OpError('thread_add: direction must be "in" (from them) or "out" (from us)');
        const id = idOk(o.id) ? (o.id as string) : "m" + at.replace(/\D/g, "").slice(0, 14) + dir;
        const arr = (s.thread ??= []); if (arr.some((m) => m.id === id)) break;
        arr.push({ id, at, dir, subject: str(o.subject, 200), body, src: str(o.source, 30).toLowerCase() || "gmail", from: str(o.from, 200) || undefined, to: str(o.to, 200) || undefined });
        arr.sort((x, y) => x.at.localeCompare(y.at)); s.thread = arr.slice(-200); break;
      }
      case "thread_remove": { const a = (s.thread ??= []), i = a.findIndex((m) => m.id === o.id); if (i < 0) throw new OpError("thread_remove: no message with that id"); a.splice(i, 1); break; }
      case "comment_add": {
        const t = typeof o.text === "string" ? o.text.trim().slice(0, 10000) : ""; if (!t) throw new OpError("comment_add: text is empty");
        const id = idOk(o.id) ? (o.id as string) : newId("c"); if ((s.comments ??= []).some((x) => x.id === id)) break;
        s.comments.unshift({ id, who, at: now(), t }); log("commented"); break;
      }
      case "comment_remove": { const a = (s.comments ??= []), i = find(a, o, (x) => x.t); a.splice(i, 1); log("removed a comment"); break; }
      default: throw new OpError(`unknown op "${o.op}". Use: stage, set, note_append, check, todo_add, todo_done, todo_remove, link_add, link_remove, comment_add, comment_remove, thread_add, thread_remove`);
    }
  }
  s.hist = (s.hist ?? []).slice(-500); s.comments = s.comments?.slice(0, 500); s.todos = s.todos?.slice(-200); s.links = s.links?.slice(-100);
}

export async function findDeal(name: string, stores?: Stores) {
  const s = stores ?? (await readStores()), all = await allBases(s), q = name.trim().toLowerCase();
  return all.find((d) => d.n.toLowerCase() === q) ?? all.find((d) => d.id && d.id === name) ?? null;
}

export async function changeDeal(name: string, ops: Op[], who: string, by: string) {
  if (!Array.isArray(ops) || !ops.length) throw new OpError("ops must be a list of changes");
  if (ops.length > 50) throw new OpError("50 changes at most per call");
  const stores = await readStores(), d = await findDeal(name, stores);
  if (!d) throw new OpError(`No deal called "${name}"`);
  const s = (stores[d.n] ??= {});
  apply(d, s, ops, who);
  s.updated_at = new Date().toISOString(); s.updated_by = by;
  await writeStores(stores);
  return { base: d, stored: s, view: view(d, s) };
}

export async function createDeal(b: Record<string, unknown>, who: string, by: string) {
  const name = str(b.name, 120); if (!name) throw new OpError("name is required");
  const stores = await readStores();
  if (await findDeal(name, stores)) throw new OpError(`There is already a deal called "${name}"`);
  const brand = String(b.brand ?? "").toLowerCase(), bn = brand.startsWith("d") || b.b === 2 ? 2 : brand.startsWith("g") || b.b === 1 ? 1 : 0;
  if (!bn) throw new OpError('brand must be "Glued" or "Digital Socios"');
  const st = b.stage ? STAGES.find((x) => x.toLowerCase() === String(b.stage).toLowerCase()) : "Positive reply";
  if (!st) throw new OpError(`stage must be one of: ${STAGES.join(", ")}`);
  const owner = typeof b.owner === "string" && OWNERS[b.owner] && b.owner !== "grok" ? b.owner : "dan";
  const due = day(b.next_step_due); if (due === undefined) throw new OpError("next_step_due must look like 2026-12-01");
  const c = (b.contact ?? {}) as Record<string, unknown>;
  const base: Base = {
    n: name, b: bn as 1 | 2, st, v: typeof b.value === "number" && b.value >= 0 ? Math.round(b.value) : 0, p: typeof b.probability === "number" && b.probability >= 0 && b.probability <= 100 ? Math.round(b.probability) : 20,
    who: owner, step: str(b.next_step, 200) || "Book a call", due: due ?? null, t: "Cold",
    person: str(c.person, 120) || undefined, title: str(c.title, 120) || undefined, email: str(c.email, 200) || undefined, company: str(c.company, 160) || name,
    source: str(b.source, 40) || (who === "grok" ? "Grokbot" : "Added by hand"), campaign: str(b.campaign, 160) || undefined,
    domain: str(c.website ?? b.website, 200).replace(/^https?:\/\//i, "").replace(/\/+$/, "") || undefined, added: new Date().toISOString(),
  };
  const s: Stored = { base, hist: [{ at: base.added!, who, what: `added this deal at ${st} for ${OWNERS[owner]}` }], updated_at: base.added, updated_by: by };
  stores[name] = s;
  if (Array.isArray(b.ops) && b.ops.length) apply(base, s, b.ops as Op[], who);
  await writeStores(stores);
  return { base, stored: s, view: view(base, s) };
}

// The app's first load sends the deals from before launch. Only names not stored yet are added; nothing else is touched.
export async function seedBases(list: unknown, by: string) {
  if (!Array.isArray(list) || list.length > 200) throw new OpError("seed must be a list of up to 200 deals");
  const stores = await readStores(), doc = await readDoc(), leads = new Set((doc.leads ?? []).map((l) => l.n));
  let added = 0;
  for (const r of list as Record<string, unknown>[]) {
    const n = str(r?.n, 120); if (!n || stores[n]?.base || leads.has(n)) continue;
    const st = STAGES.find((x) => x === r.st) ?? "Positive reply", who = typeof r.who === "string" && OWNERS[r.who] && r.who !== "grok" ? r.who : "andres";
    const base: Base = { n, b: r.b === 1 ? 1 : 2, st, v: typeof r.v === "number" && r.v >= 0 ? Math.round(r.v) : 0, p: typeof r.p === "number" && r.p >= 0 && r.p <= 100 ? Math.round(r.p) : 20,
      who, step: str(r.step, 200), due: day(r.due) ?? null, t: ["Hot", "Warm", "Cold"].includes(String(r.t)) ? String(r.t) : "Cold" };
    stores[n] = { ...(stores[n] ?? {}), base }; added++;
  }
  if (added) { await writeStores(stores); }
  return { added, stores };
}
