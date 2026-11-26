import { readDoc, CHANNELS, todayInSV, type Doc, type Channel } from "./store";
import { allBases, readStores, view, type DealView } from "./deals";
import { readCosts, type Cost } from "./costs";

// Every number on the Sales tabs (Financials, Analytics, Capacity), worked out on the server so Grokbot can read and check them.
// They come from what is stored: the daily numbers (Smartlead, Explee, the calls API, Update numbers), the deals, the cost sheet and the plans.
// The app also falls back to the Q4 files for dates before the tools were connected; this API does not, and says so in "notes".
export const QUOTA = { deals_per_brand_month: 3, aov: 15000, from: "2026-10" };
const DAY = 864e5;
const P = (s: string) => new Date(s + "T12:00:00Z");
const S = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => S(new Date(P(s).getTime() + n * DAY));
const nDays = (a: string, b: string) => Math.round((P(b).getTime() - P(a).getTime()) / DAY) + 1;
const range = (a: string, b: string) => { const o: string[] = []; for (let d = a; d <= b; d = addDays(d, 1)) o.push(d); return o; };
const months = (a: string, b: string) => { const o: string[] = []; let m = a.slice(0, 7); while (m <= b.slice(0, 7)) { o.push(m); const [y, mm] = m.split("-").map(Number); m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; } return o; };
const mDays = (m: string) => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
const r1 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const r0 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v));
const div = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? a / b : null);
type Brand = 0 | 1 | 2;
const BK = ["", "glued", "ds"] as const;
const FLOWS = ["sent", "replies", "positives", "bounced", "calls"] as const;
type Flow = (typeof FLOWS)[number];

function sums(doc: Doc, ch: Channel, a: string, b: string, brand: Brand) {
  const out: Record<Flow, number> & { days: number; split: boolean } = { sent: 0, replies: 0, positives: 0, bounced: 0, calls: 0, days: 0, split: true };
  for (const d of range(a, b)) {
    const c = doc.days[d]?.[ch]; if (!c) continue; let any = false;
    for (const f of FLOWS) {
      const src = brand ? c.by_brand?.[BK[brand] as "glued" | "ds"] : c;
      if (brand && (!src || typeof src[f] !== "number")) { if (typeof c[f] === "number" && c[f]) out.split = false; continue; }
      if (src && typeof src[f] === "number") { out[f] += src[f] as number; any = true; }
    }
    if (any) out.days++;
  }
  return out;
}
function latest(doc: Doc, ch: Channel, f: string, upto: string) {
  for (const d of Object.keys(doc.days).filter((x) => x <= upto).sort().reverse()) { const v = (doc.days[d]?.[ch] as Record<string, unknown> | undefined)?.[f]; if (typeof v === "number") return { v, date: d }; }
  return null;
}
function wonAt(d: DealView) { const h = d.history.filter((x) => / to Won$/.test(x.what)).map((x) => String(x.at)).sort().pop(); return h ? h.slice(0, 10) : null; }
function costFor(rows: Cost[], a: string, b: string, brand: Brand, kind: "actual" | "plan") {
  let usd = 0; const cats: Record<string, number> = {}, unknown = new Set<string>(), flagged: Cost[] = [];
  for (const m of months(a, b)) {
    const md = mDays(m), s = a > m + "-01" ? a : m + "-01", e = b < `${m}-${md}` ? b : `${m}-${md}`, fr = nDays(s, e) / md;
    let rs = rows.filter((r) => r.month === m && (kind === "plan" ? r.type === "projected" : r.type !== "projected"));
    if (kind === "plan" && !rs.length) { const last = rows.filter((r) => r.type === "projected").map((r) => r.month).sort().pop(); if (last) rs = rows.filter((r) => r.month === last && r.type === "projected"); }
    for (const r of rs) {
      if (brand && r.brand !== "shared" && r.brand !== (brand === 1 ? "Glued" : "Digital Socios")) continue;
      if (r.amount == null) { unknown.add(r.category); continue; }
      const v = r.amount * (r.brand === "shared" && brand ? 0.5 : 1) * fr; usd += v; cats[r.category] = (cats[r.category] ?? 0) + v;
      if (r.status === "failed" || r.status === "unpaid") flagged.push(r);
    }
  }
  return { usd: r2(usd)!, by_category: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, r2(v)])), no_price_yet: [...unknown], payment_issues: flagged.map((r) => ({ month: r.month, item: r.item, amount: r.amount, status: r.status })) };
}

export async function metrics(opts: { from?: string | null; to?: string | null; brand?: string | null }) {
  const today = todayInSV(), brand: Brand = /^g/i.test(opts.brand ?? "") ? 1 : /^d/i.test(opts.brand ?? "") ? 2 : 0, parts = brand ? 1 : 2;
  const from = opts.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from) ? opts.from : today.slice(0, 8) + "01";
  let to = opts.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to) ? opts.to : today; if (to > today) to = today;
  const [doc, stores, costs] = await Promise.all([readDoc(), readStores(), readCosts()]);
  const deals = (await allBases(stores)).map((d) => view(d, stores[d.n])).filter((d) => !brand || d.brand === (brand === 1 ? "Glued" : "Digital Socios"));
  const ch = Object.fromEntries(CHANNELS.map((c) => [c, sums(doc, c, from, to, brand)])) as Record<Channel, ReturnType<typeof sums>>;
  const tot = { sent: 0, replies: 0, positives: 0, bounced: 0, calls: 0 };
  for (const c of CHANNELS) for (const f of FLOWS) tot[f] += ch[c][f];
  const callsOther = (doc.calls ?? []).filter((c) => c.date >= from && c.date <= to && c.status !== "canceled" && !(CHANNELS as readonly string[]).includes(c.channel) && (!brand || c.brand === (brand === 1 ? "Glued" : "Digital Socios"))).length;
  const callsAll = tot.calls + callsOther;

  /* ---- Financials */
  const qMonths = Math.max(1, months(from, to).filter((m) => m >= QUOTA.from).length), qDeals = QUOTA.deals_per_brand_month * parts * qMonths, qUsd = qDeals * QUOTA.aov;
  const won = deals.filter((d) => d.stage === "Won").map((d) => ({ d, at: wonAt(d) })).filter((x) => x.at && x.at >= from && x.at <= to);
  const revenue = won.reduce((x, w) => x + w.d.value, 0), open = deals.filter((d) => d.stage !== "Won"), openUsd = open.reduce((x, d) => x + d.value, 0);
  const left = Math.max(0, qUsd - revenue), spend = costFor(costs.rows, from, to, brand, "actual");
  const toClose = won.map((w) => { const s = (w.d.replied_at ?? w.d.added_at ?? "").slice(0, 10); return s ? nDays(s, w.at!) - 1 : null; }).filter((x): x is number => x != null).sort((a, b) => a - b);
  const financials = {
    deals_closed: won.length, deals_quota: qDeals, revenue_closed: revenue, revenue_quota: qUsd,
    average_order_value: won.length ? r0(revenue / won.length) : null, aov_target: QUOTA.aov,
    open_pipeline: openUsd, open_pipeline_weighted: r0(open.reduce((x, d) => x + d.weighted, 0)), open_deals: open.length,
    pipeline_coverage: left > 0 ? r1(openUsd / left) : null, coverage_target: 3,
    sales_spend: spend.usd, spend_by_category: spend.by_category, spend_no_price_yet: spend.no_price_yet, payment_issues: spend.payment_issues,
    cost_per_lead: r2(div(spend.usd, tot.positives)), cost_per_booked_call: r2(div(spend.usd, callsAll)), cac: r0(div(spend.usd, won.length)),
    win_rate_pct: r1(div(won.length * 100, callsAll)), lead_to_call_pct: r1(div(callsAll * 100, tot.positives)), days_to_close_median: toClose.length ? toClose[Math.floor(toClose.length / 2)] : null,
    won: won.map((w) => ({ name: w.d.name, brand: w.d.brand, value: w.d.value, won_on: w.at })),
    by_brand: brand ? undefined : Object.fromEntries((["Glued", "Digital Socios"] as const).map((bn) => { const ws = won.filter((w) => w.d.brand === bn); return [bn, { deals_closed: ws.length, deals_quota: QUOTA.deals_per_brand_month * qMonths, revenue_closed: ws.reduce((x, w) => x + w.d.value, 0), revenue_quota: QUOTA.deals_per_brand_month * qMonths * QUOTA.aov }]; })),
  };

  /* ---- Analytics */
  const channels = Object.fromEntries(CHANNELS.map((c) => { const s = ch[c]; const has = s.days > 0 && (brand ? s.split : true);
    return [c, has ? { sent: s.sent, replies: s.replies, reply_rate_pct: r2(div(s.replies * 100, s.sent)), positives: s.positives, emails_per_positive: r0(div(s.sent, s.positives)), bounced: s.bounced, bounce_rate_pct: r2(div(s.bounced * 100, s.sent)), calls: s.calls, days_with_numbers: s.days } : null]; }));
  const inboxes = Object.fromEntries(CHANNELS.map((c) => { const g = (f: string) => latest(doc, c, f, to);
    const real = g("real_capacity"), total = g("total_capacity");
    return [c, { inboxes: g("inboxes")?.v ?? null, google: g("inboxes_google")?.v ?? null, outlook: g("inboxes_outlook")?.v ?? null, burnt: g("burnt_inboxes")?.v ?? null,
      real_capacity: real?.v ?? null, total_capacity: total?.v ?? null, healthy_pct: real && total && total.v ? r1(real.v / total.v * 100) : null, as_of: real?.date ?? g("inboxes")?.date ?? null }]; }));
  const daily = range(from, to).map((d) => ({ date: d, ...Object.fromEntries(CHANNELS.map((c) => [c, ((brand ? doc.days[d]?.[c]?.by_brand?.[BK[brand] as "glued" | "ds"] : doc.days[d]?.[c]) as Record<string, number> | undefined)?.sent ?? null])),
    positives: CHANNELS.reduce((x, c) => x + ((((brand ? doc.days[d]?.[c]?.by_brand?.[BK[brand] as "glued" | "ds"] : doc.days[d]?.[c]) as Record<string, number> | undefined)?.positives) ?? 0), 0) }));
  const analytics = {
    totals: { ...tot, calls_all_sources: callsAll, reply_rate_pct: r2(div(tot.replies * 100, tot.sent)), bounce_rate_pct: r2(div(tot.bounced * 100, tot.sent)), emails_per_positive: r0(div(tot.sent, tot.positives)) },
    funnel: [{ step: "Emails sent", value: tot.sent }, { step: "Replies", value: tot.replies }, { step: "Leads (positive replies)", value: tot.positives }, { step: "Booked calls", value: callsAll }, { step: "Deals won", value: won.length }],
    channels, inbox_health: inboxes, daily,
  };

  /* ---- Capacity: tomorrow plus 60 days. What the channels can send (each month's plan, or the healthy capacity), and the leads, calls
     and closes that should come from it at the rates of the last 30 days (the app's Capacity tab) */
  const fa = addDays(today, 1), fb = addDays(today, 60), r30 = addDays(today, -29), MK: Record<string, string> = { "12": "dec", "01": "jan", "02": "feb" };
  const mo = sums.bind(null, doc);
  const last30 = Object.fromEntries(CHANNELS.map((c) => [c, mo(c, r30, today, 0)])) as Record<Channel, ReturnType<typeof sums>>;
  const e30 = CHANNELS.reduce((x, c) => x + last30[c].sent, 0), p30 = CHANNELS.reduce((x, c) => x + last30[c].positives, 0);
  const calls30 = CHANNELS.reduce((x, c) => x + last30[c].calls, 0) + (doc.calls ?? []).filter((c) => c.date >= r30 && c.date <= today && c.status !== "canceled" && !(CHANNELS as readonly string[]).includes(c.channel)).length;
  const wins30 = deals.filter((d) => d.stage === "Won").map(wonAt).filter((x) => x && x >= r30 && x <= today).length;
  const q4 = CHANNELS.reduce((x, c) => { const s = mo(c, "2026-10-01", today, 0); return { e: x.e + s.sent, p: x.p + s.positives }; }, { e: 0, p: 0 });
  const eplAll = p30 > 0 ? e30 / p30 : q4.p > 0 ? q4.e / q4.p : 350;
  const callRate = p30 > 0 && calls30 > 0 ? calls30 / p30 * 100 : 15, closeRate = wins30 > 0 && calls30 > 0 ? wins30 / calls30 * 100 : 7.6;
  const share = (() => { if (!brand) return 1; let g = 0, t = 0; for (const c of CHANNELS) { const s = mo(c, r30, today, brand); if (s.split) { g += s.sent; t += last30[c].sent; } } return t > 0 ? g / t : 0.5; })();
  const capDays = range(fa, fb), planCr = typeof doc.close_rate === "number" && doc.close_rate > 0 ? doc.close_rate : null;      // % of leads that become clients, from the plan
  const perDay = (c: Channel, d: string) => { const mk = MK[d.slice(5, 7)], pj = mk ? doc.projections?.[c]?.[mk] : undefined; const m = pj && typeof pj.e === "number" ? pj.e : latest(doc, c, "real_capacity", today)?.v ?? 0; return m / mDays(d.slice(0, 7)) * share; };
  const byCh = Object.fromEntries(CHANNELS.map((c) => {
    const own = last30[c].positives > 0, epl30 = own ? last30[c].sent / last30[c].positives : eplAll;
    /* each day's leads use that month's plan ratio when one is set (Edit plan or POST /projections), else the last 30 days */
    const eplD = (d: string) => { const mk = MK[d.slice(5, 7)], r = mk ? doc.projections?.[c]?.[mk]?.r : null; return typeof r === "number" && r > 0 ? r : epl30; };
    const e = capDays.reduce((x, d) => x + perDay(c, d), 0), l = capDays.reduce((x, d) => x + perDay(c, d) / eplD(d), 0), epl = l > 0 ? e / l : epl30;
    const planR = ["dec", "jan", "feb"].some((mk) => typeof doc.projections?.[c]?.[mk]?.r === "number");
    return [c, { emails: r0(e), emails_per_positive: r0(epl), emails_per_positive_source: planR ? "the plan's ratio (months without one use the last 30 days)" : own ? `${last30[c].sent} emails, ${last30[c].positives} positive replies in the last 30 days` : "no positive reply in the last 30 days: all channels' rate",
      leads: r0(l), calls: r0(l * callRate / 100), closes: r1(planCr != null ? l * planCr / 100 : l * callRate / 100 * closeRate / 100), healthy_capacity_month: latest(doc, c, "real_capacity", today)?.v ?? null,
      plan: Object.fromEntries(["dec", "jan", "feb"].map((mk) => [mk, doc.projections?.[c]?.[mk]?.e ?? null])) }];
  })) as unknown as Record<Channel, { emails: number | null; leads: number | null; calls: number | null; closes: number | null }>;
  const sends = CHANNELS.reduce((x, c) => x + (byCh[c].emails ?? 0), 0), leads = CHANNELS.reduce((x, c) => x + (byCh[c].leads ?? 0), 0);
  const calls = leads * callRate / 100, closes = planCr != null ? leads * planCr / 100 : calls * closeRate / 100, qD = QUOTA.deals_per_brand_month * parts * 2;
  const weekly: Record<string, number | string>[] = [];
  for (let i = 0; i < capDays.length; i += 7) { const w = capDays.slice(i, i + 7); weekly.push({ week_from: w[0], week_to: w[w.length - 1], ...Object.fromEntries(CHANNELS.map((c) => [c, Math.round(w.reduce((x, d) => x + perDay(c, d), 0))])) }); }
  const capacity = {
    from: fa, to: fb,
    sending_capacity: sends, daily_average: r0(sends / 60),
    projected: { leads, calls: r0(calls), closes: r1(closes), revenue: r0(closes * QUOTA.aov) },
    targets: { sending_capacity: 1200000 / (brand ? 2 : 1), daily: 20000 / (brand ? 2 : 1), leads: 2000 / (brand ? 2 : 1), calls: r0(qD / (closeRate / 100)), closes: qD },
    rates_last_30_days: { from: r30, to: today, emails_per_positive_all: r0(eplAll), call_rate_pct: r1(callRate), call_rate_source: p30 > 0 && calls30 > 0 ? `${calls30} calls from ${p30} positive replies` : "no calls stored for the last 30 days: 15% used",
      close_rate_pct: r1(closeRate), close_rate_source: wins30 > 0 ? `${wins30} deals won from ${calls30} calls` : "no deal won in the last 30 days: this year's 7.6% used", brand_share_of_emails: r2(share) },
    lead_to_client_pct: planCr != null ? planCr : r2(callRate * closeRate / 100), lead_to_client_source: planCr != null ? "set in the plan (Edit plan or POST /projections close_rate)" : "the last 30 days: call rate times close rate",
    by_channel: byCh, weekly,
  };
  return {
    window: { from, to, brand: ["both", "Glued", "Digital Socios"][brand], today },
    financials, analytics, capacity,
    notes: [
      "Numbers come from what the app stores: daily numbers (Smartlead, Explee, the calls API, Update numbers), deals, the cost sheet and the channel plans.",
      "The app also shows the Q4 files for dates before Smartlead and Explee were connected (and calls before the calls API). This API does not, so older totals can be lower here.",
      "Costs leave out team pay. Monthly bills are spread over the days asked for.",
      "Deal values are the whole signed contract: a Digital Socios retainer is the monthly fee times the months signed.",
    ],
  };
}
