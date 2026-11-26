import { readDoc, CHANNELS, todayInSV, type Doc, type Channel } from "./store";
import { allBases, readStores, view, type DealView } from "./deals";
import { readCosts, type Cost } from "./costs";

// Every number on the Sales tabs (Financials, Analytics, Forecast), worked out on the server so Grokbot can read and check them.
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

  /* ---- Forecast: tomorrow plus 60 days */
  const fa = addDays(today, 1), fb = addDays(today, 60), MK: Record<string, string> = { "12": "dec", "01": "jan", "02": "feb" };
  const q4 = CHANNELS.reduce((x, c) => { const s = sums(doc, c, "2026-10-01", today, 0); return { e: x.e + s.sent, p: x.p + s.positives }; }, { e: 0, p: 0 });
  const epl = q4.p > 0 ? q4.e / q4.p : 350;
  const share = (() => { if (!brand) return 1; let g = 0, t = 0; for (const c of CHANNELS) { const s = sums(doc, c, addDays(today, -29), today, brand), a = sums(doc, c, addDays(today, -29), today, 0); if (s.split) { g += s.sent; t += a.sent; } } return t > 0 ? g / t : 0.5; })();
  const mo = sums.bind(null, doc);
  const thisMonth = CHANNELS.reduce((x, c) => { const s = mo(c, today.slice(0, 8) + "01", today, 0); return { p: x.p + s.positives, c: x.c + s.calls }; }, { p: 0, c: 0 });
  const callsMonth = thisMonth.c + (doc.calls ?? []).filter((c) => c.date >= today.slice(0, 8) + "01" && c.status !== "canceled" && !(CHANNELS as readonly string[]).includes(c.channel)).length;
  const callRate = thisMonth.p > 0 && callsMonth > 0 ? callsMonth / thisMonth.p * 100 : 16.5;
  const winsQ = deals.filter((d) => d.stage === "Won").map(wonAt).filter((x) => x && x >= "2026-10-01").length, callsQ = CHANNELS.reduce((x, c) => x + mo(c, "2026-10-01", today, 0).calls, 0);
  const winRate = winsQ >= 3 && callsQ > 0 ? winsQ / callsQ * 100 : 7.6;
  const mons = months(fa, fb).map((m) => { const md = mDays(m), s = fa > m + "-01" ? fa : m + "-01", e = fb < `${m}-${md}` ? fb : `${m}-${md}`; return { m, fr: nDays(s, e) / md, mk: MK[m.slice(5)] }; });
  const plan = Object.fromEntries(CHANNELS.map((c) => {
    const cap = latest(doc, c, "real_capacity", today)?.v ?? 0, sm = mo(c, today.slice(0, 8) + "01", today, 0), own = sm.positives > 0 ? sm.sent / sm.positives : null;
    let e = 0, l = 0; const byMonth: Record<string, { emails: number; ratio: number; planned: boolean }> = {};
    for (const x of mons) { const pj = x.mk ? doc.projections?.[c]?.[x.mk] : undefined, em = pj && typeof pj.e === "number" ? pj.e : cap, ra = pj && typeof pj.r === "number" && pj.r > 0 ? pj.r : own ?? epl;
      byMonth[x.m] = { emails: em, ratio: r0(ra)!, planned: !!(pj && typeof pj.e === "number") }; e += em * x.fr; l += em * x.fr / ra; }
    return [c, { healthy_capacity_month: cap, months: byMonth, emails_60d: r0(e * share), leads_60d: r0(l * share) }];
  }));
  const sends = CHANNELS.reduce((x, c) => x + (plan[c].emails_60d ?? 0), 0), leads = CHANNELS.reduce((x, c) => x + (plan[c].leads_60d ?? 0), 0);
  const calls = leads * callRate / 100, dealsX = calls * winRate / 100, qD = QUOTA.deals_per_brand_month * parts * 2;
  const needCalls = qD / (winRate / 100), needLeads = needCalls / (callRate / 100), needEmails = needLeads * epl, gap = Math.max(0, needEmails - sends);
  const perInbox = 160, warm = 21, sendDays = 60 - warm, spendPlan = costFor(costs.rows, fa, fb, brand, "plan");
  const weighted = open.reduce((x, d) => x + d.weighted, 0);
  const forecast = {
    from: fa, to: fb,
    rates: { call_rate_pct: r1(callRate), call_rate_source: thisMonth.p > 0 && callsMonth > 0 ? `${callsMonth} calls from ${thisMonth.p} positive replies this month` : "no calls stored this month yet: 16.5% (November from the Q4 files)",
      win_rate_pct: r1(winRate), win_rate_source: winsQ >= 3 ? `${winsQ} deals won from ${callsQ} calls since Oct 1` : "7.6%: 13 new clients from 171 Glued calls this year", emails_per_lead: r0(epl), aov: QUOTA.aov },
    expected: { emails: sends, leads, calls: r0(calls), deals: r1(dealsX), revenue: r0(dealsX * QUOTA.aov) },
    targets: { emails: 600000 * 2 / (brand ? 2 : 1), leads: 1000 * 2 / (brand ? 2 : 1), deals: qD, revenue: qD * QUOTA.aov },
    what_it_takes: { calls_needed: r0(needCalls), leads_needed: r0(needLeads), emails_needed: r0(needEmails), emails_short: r0(gap), inboxes_to_buy_now: gap ? Math.ceil(gap / (perInbox / 30 * sendDays)) : 0, explee_cost_instead: r0(gap * 0.04),
      assumptions: `${perInbox} emails a month per inbox, ${warm} days of warm-up, Explee at $0.04 an email` },
    revenue_in_sight: { open_pipeline_weighted: r0(weighted), new_from_outbound: r0(dealsX * QUOTA.aov), total: r0(weighted + dealsX * QUOTA.aov), quota: qD * QUOTA.aov },
    planned_spend: spendPlan.usd, cost_per_expected_lead: r2(div(spendPlan.usd, leads)), expected_cac: r0(dealsX >= 0.5 ? spendPlan.usd / dealsX : null),
    by_channel: plan,
  };
  return {
    window: { from, to, brand: ["both", "Glued", "Digital Socios"][brand], today },
    financials, analytics, forecast,
    notes: [
      "Numbers come from what the app stores: daily numbers (Smartlead, Explee, the calls API, Update numbers), deals, the cost sheet and the channel plans.",
      "The app also shows the Q4 files for dates before Smartlead and Explee were connected (and calls before the calls API). This API does not, so older totals can be lower here.",
      "Costs leave out team pay. Monthly bills are spread over the days asked for.",
      "Deal values are the whole signed contract: a Digital Socios retainer is the monthly fee times the months signed.",
    ],
  };
}
