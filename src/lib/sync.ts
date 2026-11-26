import { type Doc, type BrandSplit, type Lead, setDay, addLog, todayInSV, updateDoc } from "./store";

// Refresh: pull Smartlead and Explee into the daily store.
// Smartlead (ScaledMail and Mailin inboxes): emails sent, replies, bounces and positive replies per day, split Glued / Digital Socios
// by campaign name; and today, the inboxes by channel (tag "Mailin" or not): count, Google / Outlook, burnt (warm-up under 95% or
// SMTP/IMAP failing) and their daily sending limit. Every day is stored in El Salvador time.
// Explee: emails sent per day (its usage report, UTC days, split by project = brand), positive replies per day (hot leads, by the
// moment they turned hot) and replies per day (conversations, by their latest reply).

const SL = process.env.SMARTLEAD_API_BASE || "https://server.smartlead.ai/api/v1";      // the override is for local tests
const EX = process.env.EXPLEE_API_BASE || "https://api.explee.com/public/api/v1";
const TZ = "America/El_Salvador";
const FIRST_DAY = "2026-01-01";      // the first pull goes back to January; after that, the last 14 days each time
const BURN_UNDER = 95;

export type Report = { source: string; ok: boolean; msg: string; debug?: unknown };

const num = (v: unknown) => { const n = typeof v === "string" ? Number(v.replace(/[%,\s]/g, "")) : typeof v === "number" ? v : NaN; return Number.isFinite(n) ? n : null; };
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmt = (n: number) => n.toLocaleString("en-US");
const svDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const brandOf = (name: string) => (/\b(ds|digital\s*socios|socios)\b/i.test(name) ? "ds" : "glued");

/* ---------------- Smartlead ---------------- */

async function sl<T = unknown>(key: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ api_key: key, ...params });
  const r = await fetch(`${SL}${path}?${qs}`, { cache: "no-store", signal: AbortSignal.timeout(45000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Smartlead ${path} said ${r.status}${text ? ": " + text.slice(0, 160) : ""}`);
  try { return JSON.parse(text) as T; } catch { throw new Error(`Smartlead ${path} did not send JSON`); }
}

type SlDay = { date: string; m: Record<string, unknown> };
// Smartlead answers { data: { day_wise_stats: [ { date: "18 Nov", day_name, email_engagement_metrics: { sent, replied, ... } } ] } }.
// The date has no year, so it is read against the dates asked for.
function slDays(j: unknown, from: string, to: string): SlDay[] {
  const o = j as { data?: { day_wise_stats?: Record<string, unknown>[] } };
  const rows = o?.data?.day_wise_stats ?? [];
  const out: SlDay[] = [];
  for (const r of rows) {
    const raw = String(r.date ?? "").trim(); let iso: string | null = null;
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) iso = raw.slice(0, 10);
    else {
      const m = /^(\d{1,2})\s+([A-Za-z]{3})/.exec(raw); if (!m) continue;
      const mi = MON.indexOf(m[2].toLowerCase()); if (mi < 0) continue;
      const dd = String(+m[1]).padStart(2, "0"), mm = String(mi + 1).padStart(2, "0");
      for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) { const c = `${y}-${mm}-${dd}`; if (c >= from && c <= to) { iso = c; break; } }
    }
    if (iso) out.push({ date: iso, m: (r.email_engagement_metrics as Record<string, unknown>) ?? r });
  }
  return out;
}

async function smartlead(doc: Doc, key: string, today: string, full: boolean): Promise<Report> {
  const st = doc.sync.smartlead;
  const from = full || !st?.backfilled_from || st.backfilled_from > FIRST_DAY ? FIRST_DAY : addDays(today, -14);
  const range = { start_date: from, end_date: today, timezone: TZ };

  const camps = await sl<{ id: number; name: string }[]>(key, "/campaigns").catch(() => []);
  const ids = { glued: [] as number[], ds: [] as number[] };
  (Array.isArray(camps) ? camps : []).forEach((c) => ids[brandOf(c.name || "")].push(c.id));
  const canSplit = ids.glued.length > 0 && ids.ds.length > 0;

  const pull = async (path: string, campaignIds?: number[]) => {
    const j = await sl(key, path, campaignIds ? { ...range, campaign_ids: campaignIds.join(",") } : range);
    return new Map(slDays(j, from, today).map((r) => [r.date, r.m]));
  };
  const [all, pAll] = await Promise.all([pull("/analytics/day-wise-overall-stats"), pull("/analytics/day-wise-positive-reply-stats")]);
  const none = new Map<string, Record<string, unknown>>();
  let g = none, d = none, pg = none, pd = none;
  if (canSplit) {
    [g, d, pg, pd] = await Promise.all([
      pull("/analytics/day-wise-overall-stats", ids.glued).catch(() => none), pull("/analytics/day-wise-overall-stats", ids.ds).catch(() => none),
      pull("/analytics/day-wise-positive-reply-stats", ids.glued).catch(() => none), pull("/analytics/day-wise-positive-reply-stats", ids.ds).catch(() => none),
    ]);
  }
  // the brand split is kept only for days where Glued plus Digital Socios adds up to the total
  let splitDays = 0, days = 0, todaySent: number | null = null;
  const tot = { sent: 0, replies: 0, positives: 0 };
  for (const [date, m] of all) {
    if (date > today) continue;
    const sent = num(m.sent), replies = num(m.replied), bounced = num(m.bounced), pos = num(pAll.get(date)?.positive_replied);
    const vals: Record<string, number> = {};
    if (sent != null) vals.sent = sent;
    if (replies != null) vals.replies = replies;
    if (bounced != null) vals.bounced = bounced;
    if (pos != null) vals.positives = pos;
    let split: BrandSplit | undefined;
    const gm = g.get(date), dm = d.get(date), gs = num(gm?.sent), ds = num(dm?.sent);
    if (gm && dm && sent != null && gs != null && ds != null && gs + ds === sent) {
      const side = (x: Record<string, unknown>, p?: Record<string, unknown>) => {
        const o: Record<string, number> = { sent: num(x.sent) ?? 0 };
        const r = num(x.replied); if (r != null) o.replies = r;
        const pp = num(p?.positive_replied); if (pp != null) o.positives = pp;
        return o;
      };
      split = { glued: side(gm, pg.get(date)), ds: side(dm, pd.get(date)) }; splitDays++;
    }
    setDay(doc, date, "ScaledMail", vals, "smartlead", split);
    days++; tot.sent += sent ?? 0; tot.replies += replies ?? 0; tot.positives += pos ?? 0;
    if (date === today) todaySent = sent;
  }

  // inboxes, today: Mailin by its tag, everything else is ScaledMail
  type Box = { n: number; burnt: number; google: number; outlook: number; other: number; limit: number };
  const box = (): Box => ({ n: 0, burnt: 0, google: 0, outlook: 0, other: 0, limit: 0 });
  const B = { ScaledMail: box(), Mailin: box() };
  for (let offset = 0; offset < 20000; offset += 100) {
    const page = await sl<unknown>(key, "/email-accounts/", { offset: String(offset), limit: "100" });
    const list = (Array.isArray(page) ? page : (page as { data?: unknown[] })?.data ?? []) as Record<string, unknown>[];
    for (const a of list) {
      const tags = ((a.tags as { tag_name?: string }[]) ?? []).map((t) => String(t.tag_name ?? "").toLowerCase());
      const b = tags.includes("mailin") ? B.Mailin : B.ScaledMail;
      b.n++;
      const type = String(a.type ?? "").toUpperCase();
      if (type === "GMAIL" || type === "GOOGLE") b.google++; else if (type === "OUTLOOK" || type === "MICROSOFT") b.outlook++; else b.other++;
      const w = (a.warmup_details ?? {}) as Record<string, unknown>;
      const rep = num(w.warmup_reputation), broken = a.is_smtp_success === false || a.is_imap_success === false || w.status === "BLOCKED";
      if (broken || (rep != null && rep < BURN_UNDER)) b.burnt++;
      else b.limit += num(a.message_per_day) ?? 0;
    }
    if (list.length < 100) break;
  }
  for (const ch of ["ScaledMail", "Mailin"] as const) {
    const b = B[ch]; if (!b.n) continue;
    const vals: Record<string, number> = { inboxes: b.n, burnt_inboxes: b.burnt, inboxes_google: b.google, inboxes_outlook: b.outlook, inboxes_other: b.other, daily_limit: b.limit };
    const total = latest(doc, ch, today);
    if (total != null) vals.real_capacity = Math.round((total * (b.n - b.burnt)) / b.n);
    setDay(doc, today, ch, vals, "smartlead");
  }
  const kept = st?.backfilled_from && st.backfilled_from < from ? st.backfilled_from : from;
  doc.sync.smartlead = { at: new Date().toISOString(), ok: true, msg: `${days} days from ${from}, ${splitDays} split by brand`, backfilled_from: kept };
  return {
    source: "Smartlead", ok: true,
    msg: `Smartlead: ${todaySent != null ? fmt(todaySent) + " sent today" : "nothing sent yet today"}, ${fmt(B.ScaledMail.n + B.Mailin.n)} inboxes`,
    debug: { from, days, splitDays, campaigns: { glued: ids.glued.length, ds: ids.ds.length }, totals: tot, inboxes: B },
  };
}

function latest(doc: Doc, ch: "ScaledMail" | "Mailin", upto: string) {
  for (const d of Object.keys(doc.days).filter((x) => x <= upto).sort().reverse()) { const v = doc.days[d]?.[ch]?.total_capacity; if (typeof v === "number") return v; }
  return null;
}

/* ---------------- Explee ---------------- */

async function ex<T = unknown>(key: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${EX}${path}${qs ? "?" + qs : ""}`, { headers: { "X-API-Key": key, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(45000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Explee ${path} said ${r.status}${text ? ": " + text.slice(0, 160) : ""}`);
  try { return JSON.parse(text) as T; } catch { throw new Error(`Explee ${path} did not send JSON`); }
}
const listOf = (j: unknown, ...keys: string[]): Record<string, unknown>[] => {
  if (Array.isArray(j)) return j as Record<string, unknown>[];
  const o = j as Record<string, unknown>;
  for (const k of keys) if (Array.isArray(o?.[k])) return o[k] as Record<string, unknown>[];
  return [];
};

type Tally = { sent: number; replies: number; positives: number };
async function explee(doc: Doc, key: string, today: string): Promise<Report> {
  const dbg: Record<string, unknown> = {};
  // projects: one per brand, named by its domain
  const projects = listOf(await ex(key, "/autogtm/projects"), "projects", "items", "data");
  const projBrand = new Map<string, "glued" | "ds">();
  for (const p of projects) projBrand.set(String(p.id ?? p.project_id), brandOf(`${p.domain ?? ""} ${p.name ?? ""}`));
  dbg.projects = projects.map((p) => ({ id: p.id ?? p.project_id, name: p.name ?? p.domain, keys: Object.keys(p).slice(0, 12) }));
  const campBrand = new Map<string, "glued" | "ds">();
  try {
    const camps = listOf(await ex(key, "/autogtm/campaigns", { include_archived: "true" }), "campaigns", "items", "data");
    for (const c of camps) campBrand.set(String(c.id ?? c.campaign_id), projBrand.get(String(c.project_id ?? "")) ?? brandOf(String(c.name ?? "")));
    dbg.campaigns = camps.length;
  } catch (e) { dbg.campaigns = (e as Error).message; }

  type Flow = Tally & { g: Tally; d: Tally; has: Set<string> };
  const days = new Map<string, Flow>();
  const zero = (): Tally => ({ sent: 0, replies: 0, positives: 0 });
  const day = (d: string) => { let f = days.get(d); if (!f) days.set(d, (f = { ...zero(), g: zero(), d: zero(), has: new Set() })); return f; };

  // 1. emails sent per day, last 90 days, by project
  const usage = await ex<Record<string, unknown>>(key, "/autogtm/billing/usage", { days: "90" });
  for (const u of listOf(usage, "days")) {
    const date = String(u.date ?? "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) continue;
    const f = day(date); f.has.add("sent"); f.sent += num(u.emails_sent) ?? 0;
    for (const p of (u.projects as Record<string, unknown>[]) ?? []) { const b = projBrand.get(String(p.project_id)) ?? brandOf(String(p.name ?? "")); f[b === "ds" ? "d" : "g"].sent += num(p.emails_sent) ?? 0; }
  }
  dbg.usage_total = usage.total_emails_sent;
  // 2. positive replies per day: hot leads, by when they turned hot
  let hot = 0;
  for (let offset = 0, guard = 0; guard < 100; guard++) {
    const j = await ex<Record<string, unknown>>(key, "/autogtm/hot-leads", { limit: "200", offset: String(offset) });
    const leads = listOf(j, "leads", "items");
    for (const l of leads) {
      const at = String(l.became_hot_at ?? l.replied_at ?? ""); if (!at) continue;
      const date = svDay(at); if (date > today) continue;
      const f = day(date); f.has.add("positives"); f.positives++; hot++;
      f[campBrand.get(String(l.campaign_id)) === "ds" ? "d" : "g"].positives++;
    }
    if (!j.has_more || !leads.length) break;
    offset = num(j.next_offset) ?? offset + leads.length;
  }
  // 3. replies per day: each conversation counted once, on the day of its latest reply
  const seen = new Set<string>(); let convs = 0;
  for (const p of projects) {
    const pid = String(p.id ?? p.project_id), b = projBrand.get(pid) ?? "glued";
    for (const tab of ["need_reply", "replied", "sent"]) {
      for (let offset = 0, guard = 0; guard < (tab === "sent" ? 25 : 100); guard++) {
        let j: Record<string, unknown>;
        try { j = await ex(key, `/autogtm/projects/${pid}/inbox`, { tab, limit: "200", offset: String(offset) }); }
        catch (e) { dbg["inbox_" + tab] = (e as Error).message; break; }
        const cs = listOf(j, "contacts", "items");
        for (const c of cs) {
          const id = `${c.campaign_id}:${c.person_id ?? c.email}`, at = c.latest_reply_at as string | null;
          if (seen.has(id) || !at || !(num(c.reply_count) ?? 0)) continue;
          seen.add(id); const date = svDay(at); if (date > today) continue;
          const f = day(date); f.has.add("replies"); f.replies++; f[b === "ds" ? "d" : "g"].replies++; convs++;
        }
        if (!j.has_more || !cs.length) break;
        offset = num(j.next_offset) ?? offset + cs.length;
      }
    }
  }
  let n = 0, todaySent: number | null = null;
  for (const [date, f] of days) {
    const vals: Record<string, number> = {};
    for (const k of ["sent", "replies", "positives"] as const) if (f.has.has(k)) vals[k] = f[k];
    setDay(doc, date, "Explee", vals, "explee", { glued: f.g, ds: f.d });
    n++; if (date === today) todaySent = f.sent;
  }
  doc.sync.explee = { at: new Date().toISOString(), ok: true, msg: `${n} days, ${hot} hot leads, ${convs} conversations with replies` };
  Object.assign(dbg, { days: n, hot, conversations: convs });
  return { source: "Explee", ok: true, msg: `Explee: ${todaySent != null ? fmt(todaySent) + " sent today" : "nothing sent yet today"}, ${hot} hot leads in all`, debug: dbg };
}

/* ---------------- positive replies into the Pipeline ---------------- */
// Every run adds each new positive reply as a deal: stage "Positive reply", Cold, 20%, Daniel, no value yet.
// The first run goes back to Nov 19 (the last 7 days). After that each run looks two days back, and a reply already added is skipped.
const LEADS_FROM = "2026-11-19T06:00:00.000Z";      // Nov 19, midnight in El Salvador
const clip = (t: unknown, n = 600) => String(t ?? "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
  .split(/\n\s*(On .{5,80} wrote:|From: |-----Original)/)[0].replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
const dayAfter = (iso: string) => addDays(svDay(iso), 1);
type Raw = Omit<Lead, "n" | "st" | "p" | "who" | "t" | "v" | "step" | "due" | "added">;

async function slPositives(key: string, since: string, dbg: Record<string, unknown>): Promise<Raw[]> {
  const cats = await sl<{ id: number; sentiment_type?: string }[]>(key, "/leads/fetch-categories").catch(() => []);
  const pos = (Array.isArray(cats) ? cats : []).filter((c) => c.sentiment_type === "positive").map((c) => c.id);
  const ids = pos.length ? pos.slice(0, 10) : [1, 2, 5];
  const out: Raw[] = [];
  for (let offset = 0; offset < 600; offset += 20) {
    const qs = new URLSearchParams({ api_key: key, fetch_message_history: "false" });
    const r = await fetch(`${SL}/master-inbox/inbox-replies?${qs}`, {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ offset, limit: 20, sortBy: "REPLY_TIME_DESC", filters: { leadCategories: { categoryIdsIn: ids }, replyTimeBetween: [since, new Date().toISOString()] } }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Smartlead inbox said ${r.status}: ${text.slice(0, 160)}`);
    const j = JSON.parse(text) as Record<string, unknown>;
    const items = listOf(j, "messages", "data", "items", "leads");
    if (offset === 0) dbg.sl_first = items[0] ? Object.keys(items[0]).slice(0, 30) : j && Object.keys(j);
    for (const m of items) {
      const lead = (m.lead ?? {}) as Record<string, unknown>, camp = (m.campaign ?? {}) as Record<string, unknown>, last = (m.last_message ?? {}) as Record<string, unknown>;
      const email = String(lead.email ?? m.lead_email ?? m.email ?? ""), first = String(lead.first_name ?? m.lead_first_name ?? ""), lastN = String(lead.last_name ?? m.lead_last_name ?? "");
      const at = String(last.received_at ?? m.last_reply_time ?? m.reply_time ?? m.last_activity ?? ""), cname = String(camp.name ?? m.campaign_name ?? "");
      if (!email || !at) continue;
      out.push({ id: "sl:" + String(m.campaign_lead_map_id ?? m.id ?? email), person: `${first} ${lastN}`.trim(), email, company: String(lead.company ?? lead.company_name ?? m.lead_company ?? ""),
        domain: email.split("@")[1], b: brandOf(cname) === "ds" ? 2 : 1, source: "Smartlead", campaign: cname, reply: clip(last.body ?? m.last_reply ?? ""), at: new Date(at).toISOString() });
    }
    const total = Number(j.total_count ?? j.total ?? 0);
    if (items.length < 20 || (total && offset + 20 >= total)) break;
  }
  return out;
}

async function exPositives(key: string, since: string): Promise<Raw[]> {
  const camps = new Map<string, { name: string; b: 1 | 2 }>();
  try {
    const projects = listOf(await ex(key, "/autogtm/projects"), "projects", "items", "data");
    const pb = new Map(projects.map((p) => [String(p.id ?? p.project_id), brandOf(`${p.domain ?? ""} ${p.name ?? ""}`) === "ds" ? 2 : 1] as const));
    for (const c of listOf(await ex(key, "/autogtm/campaigns", { include_archived: "true" }), "campaigns", "items", "data"))
      camps.set(String(c.id ?? c.campaign_id), { name: String(c.name ?? ""), b: (pb.get(String(c.project_id ?? "")) ?? (brandOf(String(c.name ?? "")) === "ds" ? 2 : 1)) as 1 | 2 });
  } catch { /* brand falls back to Glued */ }
  const out: Raw[] = [];
  for (let offset = 0, guard = 0; guard < 20; guard++) {
    const j = await ex<Record<string, unknown>>(key, "/autogtm/hot-leads", { limit: "200", offset: String(offset), since });
    const leads = listOf(j, "leads", "items");
    for (const l of leads) {
      const at = String(l.became_hot_at ?? l.replied_at ?? ""); if (!at || at < since || l.erased) continue;
      const c = camps.get(String(l.campaign_id)) ?? { name: "", b: 1 as const };
      out.push({ id: `ex:${l.campaign_id}:${l.person_id}`, person: String(l.name ?? ""), email: String(l.email ?? ""), title: String(l.job_title ?? "") || undefined,
        company: String(l.company_name ?? ""), domain: String(l.company_domain ?? "") || undefined, b: c.b, source: "Explee", campaign: c.name, reply: clip(l.why_hot), at: new Date(at).toISOString() });
    }
    if (!j.has_more || !leads.length) break;
    offset = num(j.next_offset) ?? offset + leads.length;
  }
  return out;
}

async function addLeads(doc: Doc): Promise<Report> {
  doc.leads ??= [];
  const known = new Set(doc.leads.map((l) => l.id)), mails = new Set(doc.leads.map((l) => l.email.toLowerCase()).filter(Boolean));
  const last = doc.leads.reduce((a, l) => (l.at > a ? l.at : a), ""), back = new Date(Date.now() - 2 * 864e5).toISOString();
  const since = !doc.leads.length || !last ? LEADS_FROM : back < LEADS_FROM ? LEADS_FROM : back;
  const dbg: Record<string, unknown> = { since }, errs: string[] = [], raw: Raw[] = [];
  if (process.env.SMARTLEAD_API_KEY) try { raw.push(...(await slPositives(process.env.SMARTLEAD_API_KEY, since, dbg))); } catch (e) { errs.push((e as Error).message.split(process.env.SMARTLEAD_API_KEY).join("***")); }
  if (process.env.EXPLEE_API_KEY) try { raw.push(...(await exPositives(process.env.EXPLEE_API_KEY, since))); } catch (e) { errs.push((e as Error).message); }
  const now = new Date().toISOString(); let added = 0;
  for (const r of raw.sort((a, b) => a.at.localeCompare(b.at))) {
    const em = r.email.toLowerCase();
    if (known.has(r.id) || (em && mails.has(em))) continue;
    known.add(r.id); if (em) mails.add(em);
    const base = r.company || r.person || r.email; let n = base;
    for (let i = 2; doc.leads.some((l) => l.n === n); i++) n = r.person && r.person !== base && i === 2 ? `${base} (${r.person})` : `${base} ${i}`;
    doc.leads.push({ ...r, n, st: "Positive reply", p: 20, who: "dan", t: "Cold", v: 0, step: "Book a call", due: dayAfter(r.at), added: now });
    added++;
  }
  Object.assign(dbg, { found: raw.length, added, errors: errs });
  const ok = !errs.length || raw.length > 0;
  return { source: "Leads", ok, msg: added ? `${added} new positive repl${added === 1 ? "y" : "ies"} added to the Pipeline` : errs.length ? "New leads: " + errs[0] : "No new positive replies", debug: dbg };
}

/* ---------------- run ---------------- */

export async function runSync(who: string, opts: { full?: boolean } = {}): Promise<{ doc: Doc; report: Report[] }> {
  const today = todayInSV(), report: Report[] = [];
  const doc = await updateDoc(async (doc) => {
    report.length = 0;
    const tasks: [string, string | undefined, (k: string) => Promise<Report>][] = [
      ["Smartlead", process.env.SMARTLEAD_API_KEY, (k) => smartlead(doc, k, today, !!opts.full)],
      ["Explee", process.env.EXPLEE_API_KEY, (k) => explee(doc, k, today)],
    ];
    for (const [name, key, run] of tasks) {
      if (!key) { report.push({ source: name, ok: false, msg: `${name}: not connected (no API key)` }); continue; }
      try { report.push(await run(key)); }
      catch (e) {
        const msg = (e as Error).message.split(key).join("***"), k = name.toLowerCase();
        doc.sync[k] = { ...(doc.sync[k] ?? {}), at: new Date().toISOString(), ok: false, msg };
        report.push({ source: name, ok: false, msg: `${name} failed: ${msg}` });
      }
    }
    try { report.push(await addLeads(doc)); } catch (e) { report.push({ source: "Leads", ok: false, msg: "New leads failed: " + (e as Error).message }); }
    addLog(doc, who, "refresh: " + report.map((r) => r.msg).join(" · "));
  });
  return { doc, report };
}
