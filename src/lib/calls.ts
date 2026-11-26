import { updateDoc, readDoc, CHANNELS, todayInSV, addLog, type Call, type Doc } from "./store";
import { allBases, changeDeal, OpError } from "./deals";

// Booked calls from Grokbot. Each call counts on the day it was booked (El Salvador time), for its channel,
// and that day's "calls" number for the channel is recounted from the calls stored. A call that matches a deal
// (by deal name or the contact's email) is written into that deal's History, and a deal still at Positive reply moves to Call booked.
export const OTHER = ["Inbound", "Referral", "Other"] as const;
const STATUS = ["booked", "held", "no_show", "canceled"] as const;
const svDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/El_Salvador" }).format(new Date(iso));
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const when = (v: unknown) => { if (typeof v !== "string" || !v.trim()) return null; const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + "T12:00:00-06:00" : v); return Number.isNaN(t) ? null : new Date(t).toISOString(); };
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

export function cleanCall(r: Record<string, unknown>, i: number, by: string): Call | string {
  const at = when(r.at ?? r.start ?? r.start_time ?? r.meeting_at); if (!at) return `row ${i}: at must be the call's date and time, like 2026-11-27T15:00:00-06:00`;
  const booked = when(r.booked_at ?? r.created_at) ?? new Date().toISOString();
  const chRaw = str(r.channel, 40), ch = [...CHANNELS, ...OTHER].find((x) => x.toLowerCase() === chRaw.toLowerCase()) ?? (chRaw ? null : "Other");
  if (!ch) return `row ${i}: channel must be one of ${[...CHANNELS, ...OTHER].join(", ")}`;
  const bRaw = str(r.brand, 30).toLowerCase(), brand = !bRaw ? null : bRaw.startsWith("g") ? "Glued" : bRaw.startsWith("d") ? "Digital Socios" : undefined;
  if (brand === undefined) return `row ${i}: brand must be Glued or Digital Socios`;
  const status = (STATUS as readonly string[]).includes(String(r.status ?? "booked")) ? (String(r.status ?? "booked") as Call["status"]) : null;
  if (!status) return `row ${i}: status must be booked, held, no_show or canceled`;
  const email = str(r.email, 200).toLowerCase(), person = str(r.person ?? r.name, 120);
  const id = str(r.id, 80) || "call-" + hash(`${email || person}|${at}`);
  return { id, at, booked_at: booked, date: svDay(booked), person, email, company: str(r.company, 160), brand, channel: ch, source: str(r.source, 40) || "Calendly",
    status, deal: str(r.deal, 120) || null, notes: str(r.notes, 2000), added_at: new Date().toISOString(), by };
}

function recount(doc: Doc, dates: Set<string>) {
  for (const date of dates) {
    const day = (doc.days[date] ??= {});
    for (const ch of CHANNELS) {
      const cs = (doc.calls ?? []).filter((c) => c.date === date && c.channel === ch && c.status !== "canceled");
      const c = day[ch]; if (!cs.length && !(c && c.src && c.src.calls === "calls-api")) continue;      // never touch a day the calls API did not set, unless it now has calls
      const cc = (day[ch] ??= {}); cc.calls = cs.length; (cc.src ??= {}).calls = "calls-api"; cc.updated_at = new Date().toISOString();
      const g = cs.filter((x) => x.brand === "Glued").length, d = cs.filter((x) => x.brand === "Digital Socios").length;
      if (g + d === cs.length && cc.by_brand) { (cc.by_brand.glued ??= {}).calls = g; (cc.by_brand.ds ??= {}).calls = d; }
    }
  }
}

export async function addCalls(rows: unknown, by: string) {
  if (!Array.isArray(rows) || !rows.length) throw new OpError("Send { calls: [ { at, person, email, company, brand, channel, ... } ] }");
  if (rows.length > 500) throw new OpError("Up to 500 calls at a time");
  const clean: Call[] = [], errors: string[] = [];
  rows.forEach((r, i) => { const c = r && typeof r === "object" ? cleanCall(r as Record<string, unknown>, i, by) : `row ${i}: must be an object`; if (typeof c === "string") errors.push(c); else clean.push(c); });
  if (errors.length) throw new OpError(errors.slice(0, 20).join("; "));
  const today = todayInSV(); if (clean.some((c) => c.date > today)) throw new OpError("booked_at can't be in the future");
  let added = 0, updated = 0; const touched = new Set<string>();
  const doc = await updateDoc((doc) => {
    doc.calls ??= [];
    for (const c of clean) {
      const i = doc.calls.findIndex((x) => x.id === c.id);
      if (i >= 0) { touched.add(doc.calls[i].date); doc.calls[i] = { ...c, added_at: doc.calls[i].added_at }; updated++; } else { doc.calls.push(c); added++; }
      touched.add(c.date);
    }
    doc.calls = doc.calls.slice(-5000);
    recount(doc, touched);
    addLog(doc, by, `calls API: ${added} added, ${updated} updated`);
  });
  // the deals they belong to
  const bases = await allBases(), linked: { call: string; deal: string }[] = [];
  for (const c of clean) {
    const d = (c.deal && bases.find((b) => b.n.toLowerCase() === c.deal!.toLowerCase())) || (c.email && bases.find((b) => (b.email ?? "").toLowerCase() === c.email));
    if (!d) continue;
    const ops = [{ op: "comment_add", id: "cb" + hash(c.id), text: `Call ${c.status === "canceled" ? "canceled" : c.status === "held" ? "held" : c.status === "no_show" ? "missed (no show)" : "booked"} for ${new Date(c.at).toLocaleString("en-US", { timeZone: "America/El_Salvador", dateStyle: "medium", timeStyle: "short" })}${c.notes ? ": " + c.notes : ""}` }];
    if (c.status !== "canceled") ops.push({ op: "stage_if", from: "Positive reply", stage: "Call booked" } as never);
    try { await changeDeal(d.n, ops as never, "grok", by); linked.push({ call: c.id, deal: d.n }); } catch { /* a deal that can't take the change keeps the call anyway */ }
  }
  return { added, updated, linked, days: [...touched].sort(), total: (doc.calls ?? []).length };
}

export async function listCalls(from?: string | null, to?: string | null) {
  const doc = await readDoc();
  return (doc.calls ?? []).filter((c) => (!from || c.date >= from) && (!to || c.date <= to)).sort((a, b) => a.at.localeCompare(b.at));
}

export async function removeCalls(ids: unknown, by: string) {
  if (!Array.isArray(ids) || !ids.length) throw new OpError("remove must be a list of call ids");
  const del = ids.map(String); let removed = 0; const touched = new Set<string>();
  await updateDoc((doc) => {
    const keep = (doc.calls ?? []).filter((c) => { if (del.includes(c.id)) { touched.add(c.date); removed++; return false; } return true; });
    doc.calls = keep; recount(doc, touched); addLog(doc, by, `calls API: ${removed} removed`);
  });
  return { removed, days: [...touched].sort() };
}
