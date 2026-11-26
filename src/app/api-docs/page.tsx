import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentUser, isOwner } from "@/lib/session";
import { readDoc } from "@/lib/store";

export const instant = false;

const code = "block overflow-x-auto rounded-lg bg-[#0b1030] px-4 py-3 font-mono text-[12.5px] leading-5 text-[#e8ebf7]";

export default async function ApiDocs() {
  await connection();      // per request: sign-in state and a fresh form token
  const u = await currentUser();
  if (!u) redirect("/login?callbackUrl=/api-docs");
  const doc = await readDoc();
  const days = Object.keys(doc.days).sort();
  const token = isOwner(u) ? process.env.GLIDE_API_TOKEN ?? "(not set)" : null;
  const host = "https://app.getglued.co";
  const sync = Object.entries(doc.sync);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 text-[#0c1030]">
      {/* "/" is a route handler, so a full page load */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="text-sm text-[#1a5bd6] hover:underline">← Back to Sales</a>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">API for Grokbot</h1>
      <p className="mt-2 text-sm leading-6 text-[#4a5070]">
        Grokbot sends the day&apos;s numbers for each channel. The Sales screens read them for any dates you pick. A field Grokbot leaves out is kept as it was; null clears it.
      </p>

      <section className="mt-8 rounded-xl border border-[#e6e8ef] p-5">
        <h2 className="text-sm font-semibold">Token</h2>
        {token ? (
          <>
            <code className={code + " mt-3 select-all break-all whitespace-pre-wrap"}>{token}</code>
            <p className="mt-2 text-xs text-[#6b7186]">Only you see this. Anyone with it can write Sales numbers, so keep it in Grokbot&apos;s secrets. To change it, change GLIDE_API_TOKEN in Vercel.</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-[#4a5070]">Andrés holds the token.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Save numbers</h2>
        <code className={code + " mt-3 whitespace-pre"}>{`curl -X POST ${host}/api/v1/days \\
  -H "Authorization: Bearer $GLIDE_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "days": [
    { "date": "2026-11-25", "channel": "Explee",
      "sent": 1091, "positives": 2, "calls": 0,
      "real_capacity": 120000, "total_capacity": 120000,
      "burnt_inboxes": 0, "ratio": 588,
      "by_brand": { "glued": { "sent": 1091 }, "ds": { "sent": 0 } } }
  ] }'`}</code>
        <ul className="mt-4 space-y-1.5 text-sm leading-6 text-[#4a5070]">
          <li><b className="text-[#0c1030]">channel</b>: ScaledMail, Mailin, Explee or MCC</li>
          <li><b className="text-[#0c1030]">sent, positives, calls</b>: what happened that day</li>
          <li><b className="text-[#0c1030]">real_capacity, total_capacity</b>: emails a month, as of that day</li>
          <li><b className="text-[#0c1030]">burnt_inboxes</b>: inboxes under 95% warm-up health, as of that day</li>
          <li><b className="text-[#0c1030]">ratio</b>: emails sent per positive reply</li>
          <li><b className="text-[#0c1030]">by_brand</b>: optional Glued / Digital Socios split of sent, positives and calls</li>
          <li>Up to 500 rows a call. Past days are fine, future days are refused. Times are El Salvador time.</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Read numbers</h2>
        <code className={code + " mt-3 whitespace-pre"}>{`curl "${host}/api/v1/days?from=2026-11-01&to=2026-11-30" \\
  -H "Authorization: Bearer $GLIDE_API_TOKEN"`}</code>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Pull Smartlead and Explee now</h2>
        <code className={code + " mt-3 whitespace-pre"}>{`curl -X POST ${host}/api/v1/sync -H "Authorization: Bearer $GLIDE_API_TOKEN"`}</code>
        <p className="mt-2 text-sm text-[#4a5070]">Same as the refresh button. It also runs by itself every hour from 8am to 6pm, and at 11:50pm, El Salvador time.</p>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Read the Pipeline</h2>
        <code className={code + " mt-3 whitespace-pre"}>{`curl "${host}/api/v1/deals?stage=Positive%20reply" \\
  -H "Authorization: Bearer $GLIDE_API_TOKEN"

curl "${host}/api/v1/deals?name=Acme%20Co" -H "Authorization: Bearer $GLIDE_API_TOKEN"`}</code>
        <p className="mt-2 text-sm text-[#4a5070]">Each deal comes with its stage, value, owner, temperature and the 3 checks, plus its to-dos, notes, links, comments and history. Filters: name, stage, owner, brand, temperature, q.</p>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Change a deal (after a call, for example)</h2>
        <code className={code + " mt-3 whitespace-pre"}>{`curl -X POST ${host}/api/v1/deals \\
  -H "Authorization: Bearer $GLIDE_API_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "name": "Acme Co", "ops": [
    { "op": "stage", "stage": "Final approval" },
    { "op": "check", "key": "has_money", "on": true },
    { "op": "note_append", "text": "Call Nov 26: budget approved, wants to start Dec 1." },
    { "op": "comment_add", "text": "Summary of today's call: ..." },
    { "op": "todo_add", "text": "Send the contract", "due": "2026-11-27", "owner": "andres" },
    { "op": "todo_done", "text": "Book a call" },
    { "op": "link_add", "url": "https://drive.google.com/...", "name": "Acme one-pager" },
    { "op": "set", "field": "value", "value": 14000 },
    { "op": "set", "field": "board_column", "value": "In follow-ups" },
    { "op": "thread_add", "at": "2026-11-26T15:04:00Z", "direction": "in", "source": "gmail", "from": "sam@acme.co", "subject": "Re: one-pager", "body": "Looks good, Tuesday works." }
  ] }'`}</code>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[#4a5070]">
          <li>Stages: Positive reply, Call booked, Proposal, Final approval, Won. Won sets the chance to 100%.</li>
          <li>Checks: has_money, wants_project, likes_us. 3 of 3 is Hot, 2 is Warm, 1 or none is Cold.</li>
          <li>set fields: value, probability, owner (andres, david, dan), next_step, next_step_due, note, brand (Glued or Digital Socios), person, title, company, email, website.</li>
          <li>board_column: Positive reply, Prepping assets, Assets ready, In follow-ups. These are board-only columns while the stage is Positive reply; moving the stage on clears it.</li>
          <li>thread_add: an email from outside Smartlead, such as Gmail once the talk moves there. direction is &quot;in&quot; (from them) or &quot;out&quot; (from us). Smartlead emails come in with each sync by themselves. Sending the same message twice is ignored.</li>
          <li>Up to 50 changes a call. They apply in order; if one is wrong, none are saved and the error says which.</li>
          <li>Every change shows in the deal&apos;s History as Grokbot.</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Add a deal</h2>
        <code className={code + " mt-3 whitespace-pre"}>{`curl -X POST ${host}/api/v1/deals \\
  -H "Authorization: Bearer $GLIDE_API_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "create": { "name": "Northwind Coffee", "brand": "Glued", "stage": "Call booked",
    "value": 9000, "owner": "dan", "next_step": "Discovery call", "next_step_due": "2026-12-02",
    "contact": { "person": "Maya Ortiz", "email": "maya@northwind.co" } } }'`}</code>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Send booked calls</h2>
        <code className={code + " mt-3 whitespace-pre"}>{`curl -X POST ${host}/api/v1/calls \\
  -H "Authorization: Bearer $GLIDE_API_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "calls": [ { "at": "2026-11-27T15:00:00-06:00", "booked_at": "2026-11-25T10:12:00-06:00",
    "person": "Maya Ortiz", "email": "maya@northwind.co", "company": "Northwind Coffee",
    "brand": "Glued", "channel": "ScaledMail", "source": "Calendly" } ] }'`}</code>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[#4a5070]">
          <li>channel: ScaledMail, Mailin, Explee, MCC, Inbound, Referral or Other. status: booked (default), held, no_show or canceled.</li>
          <li>A call counts on the day it was booked. Send the same id (or the same email and time) again to update it; canceled calls stop counting.</li>
          <li>If the email (or deal name) matches a deal, the call goes in its History and a deal at Positive reply moves to Call booked.</li>
          <li>Once calls are sent for a stretch of dates, they replace the Q4 files&apos; call totals for those dates in the app.</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Check the data</h2>
        <code className={code + " mt-3 whitespace-pre"}>{`curl "${host}/api/v1/metrics?from=2026-11-01&to=2026-11-25&brand=both" -H "Authorization: Bearer $GLIDE_API_TOKEN"
curl "${host}/api/v1/data?parts=days,calls,costs" -H "Authorization: Bearer $GLIDE_API_TOKEN"`}</code>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[#4a5070]">
          <li>metrics: every number on Financials, Analytics and Capacity, worked out from what is stored.</li>
          <li>data: the raw records. To fix something, use the matching POST: days, calls, deals, projections, costs or plan.</li>
          <li>The full list of endpoints is at <a className="underline" href="/api/v1">/api/v1</a>.</li>
        </ul>
      </section>

      <section className="mt-8 rounded-xl border border-[#e6e8ef] p-5 text-sm">
        <h2 className="font-semibold">What&apos;s stored</h2>
        <p className="mt-2 text-[#4a5070]">{days.length ? `${days.length} days, ${days[0]} to ${days[days.length - 1]}.` : "Nothing yet."} {doc.updated_at ? `Last change ${new Date(doc.updated_at).toLocaleString("en-US", { timeZone: "America/El_Salvador", dateStyle: "medium", timeStyle: "short" })}.` : ""}</p>
        {sync.map(([k, s]) => (
          <p key={k} className="mt-1 text-[#4a5070]"><b className="text-[#0c1030] capitalize">{k}</b>: {s.ok ? "working" : "failing"}, {s.msg}, {new Date(s.at).toLocaleString("en-US", { timeZone: "America/El_Salvador", dateStyle: "medium", timeStyle: "short" })}</p>
        ))}
      </section>
    </main>
  );
}
