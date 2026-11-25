import { type Doc, setDay, addLog, todayInSV, updateDoc } from "./store";

// Refresh: pull Smartlead (ScaledMail inboxes) and Explee into the daily store.
// Smartlead gives, per day: emails sent and positive replies, split Glued / Digital Socios by campaign name.
// Today it also gives the inboxes: how many there are, and how many are burnt (warm-up health under 95%, or SMTP/IMAP failing).
// Real capacity follows the team's rule: total capacity x healthy inboxes / all inboxes.

const SL = process.env.SMARTLEAD_API_BASE || "https://server.smartlead.ai/api/v1";      // the override is for local tests
const TZ = "America/El_Salvador";
const FIRST_DAY = "2026-10-01";      // cold email restarted in October
const BURN_UNDER = 95;

export type Report = { source: string; ok: boolean; msg: string };

const num = (v: unknown) => { const n = typeof v === "string" ? Number(v.replace(/[%,\s]/g, "")) : typeof v === "number" ? v : NaN; return Number.isFinite(n) ? n : null; };
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmt = (n: number) => n.toLocaleString("en-US");

async function sl<T = unknown>(key: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ api_key: key, ...params });
  const r = await fetch(`${SL}${path}?${qs}`, { cache: "no-store", signal: AbortSignal.timeout(25000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Smartlead ${path} said ${r.status}${text ? ": " + text.slice(0, 120) : ""}`);
  try { return JSON.parse(text) as T; } catch { throw new Error(`Smartlead ${path} did not send JSON`); }
}

const brandOf = (name: string) => (/\b(ds|digital\s*socios|socios)\b/i.test(name) ? "ds" : "glued");

type DayRow = Record<string, unknown> & { date?: string };
const dayRows = (j: unknown): DayRow[] => {
  const o = j as { data?: { day_wise_stats?: DayRow[] }; day_wise_stats?: DayRow[] };
  return o?.data?.day_wise_stats ?? o?.day_wise_stats ?? (Array.isArray(j) ? (j as DayRow[]) : []);
};
// the count of positives, whatever the field is called on that endpoint
const posOf = (r: DayRow) => { for (const k of ["positive_replied", "positive_reply", "positive_replies", "positive", "count"]) { const v = num(r[k]); if (v != null) return v; } return null; };

async function smartlead(doc: Doc, key: string, today: string): Promise<Report> {
  const st = doc.sync.smartlead;
  const from = st?.backfilled_from ? addDays(today, -14) : FIRST_DAY;      // the first pull goes back to October, then two weeks each time
  const range = { start_date: from, end_date: today, timezone: TZ };

  // campaigns, to split sends by brand
  const camps = await sl<{ id: number; name: string }[]>(key, "/campaigns").catch(() => []);
  const ids = { glued: [] as number[], ds: [] as number[] };
  (Array.isArray(camps) ? camps : []).forEach((c) => ids[brandOf(c.name || "")].push(c.id));

  const pull = async (path: string, campaignIds?: number[]) => dayRows(await sl(key, path, campaignIds ? { ...range, campaign_ids: campaignIds.join(",") } : range));
  const split = ids.glued.length > 0 && ids.ds.length > 0;
  const [all, g, d, pAll, pg, pd] = await Promise.all([
    pull("/analytics/day-wise-overall-stats"),
    split ? pull("/analytics/day-wise-overall-stats", ids.glued) : Promise.resolve([]),
    split ? pull("/analytics/day-wise-overall-stats", ids.ds) : Promise.resolve([]),
    pull("/analytics/day-wise-positive-reply-stats").catch(() => null),
    split ? pull("/analytics/day-wise-positive-reply-stats", ids.glued).catch(() => null) : Promise.resolve(null),
    split ? pull("/analytics/day-wise-positive-reply-stats", ids.ds).catch(() => null) : Promise.resolve(null),
  ]);
  const by = (rows: DayRow[] | null, f: (r: DayRow) => number | null) => new Map((rows ?? []).filter((r) => r.date).map((r) => [String(r.date).slice(0, 10), f(r)]));
  const sent = by(all, (r) => num(r.sent)), sg = by(g, (r) => num(r.sent)), sd = by(d, (r) => num(r.sent));
  const pos = by(pAll, posOf), ppg = by(pg, posOf), ppd = by(pd, posOf);

  let days = 0, todaySent: number | null = null;
  for (const [date, v] of sent) {
    if (date < FIRST_DAY || date > today || v == null) continue;
    const vals: Record<string, number> = { sent: v }; const p = pos.get(date); if (p != null) vals.positives = p;
    const bs = split && sg.get(date) != null && sd.get(date) != null
      ? { glued: { sent: sg.get(date)!, ...(ppg.get(date) != null ? { positives: ppg.get(date)! } : {}) }, ds: { sent: sd.get(date)!, ...(ppd.get(date) != null ? { positives: ppd.get(date)! } : {}) } }
      : undefined;
    setDay(doc, date, "ScaledMail", vals, "smartlead", bs);
    days++; if (date === today) todaySent = v;
  }

  // inboxes, today
  let inboxes = 0, burnt = 0;
  for (let offset = 0; offset < 5000; offset += 100) {
    const page = await sl<unknown>(key, "/email-accounts/", { offset: String(offset), limit: "100" });
    const list = (Array.isArray(page) ? page : (page as { data?: unknown[] })?.data ?? []) as Record<string, unknown>[];
    for (const a of list) {
      inboxes++;
      const w = (a.warmup_details ?? {}) as Record<string, unknown>;
      const rep = num(w.warmup_reputation ?? a.warmup_reputation ?? w.reputation_score);
      const broken = a.is_smtp_success === false || a.is_imap_success === false;
      if (broken || (rep != null && rep < BURN_UNDER)) burnt++;
    }
    if (list.length < 100) break;
  }
  let capMsg = "";
  if (inboxes > 0) {
    const total = latest(doc, "ScaledMail", "total_capacity", today);
    const vals: Record<string, number> = { inboxes, burnt_inboxes: burnt };
    if (total != null) { vals.total_capacity = total; vals.real_capacity = Math.round((total * (inboxes - burnt)) / inboxes); }
    setDay(doc, today, "ScaledMail", vals, "smartlead");
    capMsg = `, ${fmt(burnt)} of ${fmt(inboxes)} inboxes burnt`;
  }
  doc.sync.smartlead = { at: new Date().toISOString(), ok: true, msg: `${days} days`, backfilled_from: st?.backfilled_from ?? from };
  return { source: "Smartlead", ok: true, msg: `Smartlead: ${todaySent != null ? fmt(todaySent) + " sent today" : "no sends yet today"}${capMsg}${split ? "" : " (no brand split: no campaign names with DS)"}` };
}

function latest(doc: Doc, ch: "ScaledMail", f: "total_capacity", upto: string) {
  for (const d of Object.keys(doc.days).filter((x) => x <= upto).sort().reverse()) { const v = doc.days[d]?.[ch]?.[f]; if (typeof v === "number") return v; }
  return null;
}

// Explee's public API covers company and people search. It has no sending numbers to pull,
// so Explee is filled by Grokbot or by Update numbers until Explee adds them.
async function explee(): Promise<Report> {
  if (!process.env.EXPLEE_API_KEY) return { source: "Explee", ok: false, msg: "Explee: not connected (no API key)" };
  return { source: "Explee", ok: false, msg: "Explee: its API has no sending numbers, so Grokbot fills them" };
}

export async function runSync(who: string): Promise<{ doc: Doc; report: Report[] }> {
  const today = todayInSV(), report: Report[] = [];
  const doc = await updateDoc(async (doc) => {
    report.length = 0;
    const key = process.env.SMARTLEAD_API_KEY;
    if (!key) report.push({ source: "Smartlead", ok: false, msg: "Smartlead: not connected (no API key)" });
    else {
      try { report.push(await smartlead(doc, key, today)); }
      catch (e) { const msg = (e as Error).message.replace(key, "***"); doc.sync.smartlead = { ...(doc.sync.smartlead ?? {}), at: new Date().toISOString(), ok: false, msg }; report.push({ source: "Smartlead", ok: false, msg: "Smartlead failed: " + msg }); }
    }
    report.push(await explee());
    addLog(doc, who, "refresh: " + report.map((r) => r.msg).join(" · "));
  });
  return { doc, report };
}
