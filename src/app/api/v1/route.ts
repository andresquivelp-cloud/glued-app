import { json } from "@/lib/api";

// What the API takes. No numbers here; those need the token.
export async function GET() {
  return json({
    name: "Glide Sales API",
    auth: "Authorization: Bearer <GLIDE_API_TOKEN>",
    endpoints: {
      "GET /api/v1/days?from=2026-11-01&to=2026-11-25&channel=ScaledMail": "Stored days. from, to and channel are optional.",
      "POST /api/v1/days": "Save days. Body: { days: [ { date, channel, ...fields } ] }, up to 500 rows. A field you leave out is kept; null clears it.",
      "POST /api/v1/sync": "Same as the refresh button: pulls Smartlead and Explee for today.",
    },
    channels: ["ScaledMail", "Mailin", "Explee", "MCC"],
    fields: {
      sent: "Emails sent that day",
      positives: "Positive replies that day",
      calls: "Calls booked that day",
      real_capacity: "Emails a month the healthy inboxes can send, as of that day",
      total_capacity: "Emails a month you pay for, as of that day",
      burnt_inboxes: "Inboxes under 95% warm-up health, as of that day",
      ratio: "Emails sent per positive reply, as of that day",
      inboxes: "Inboxes on the channel, as of that day",
      by_brand: "Optional split of sent, positives and calls: { glued: { sent, positives, calls }, ds: { ... } }",
      note: "Optional short text",
    },
    example: { days: [{ date: "2026-11-25", channel: "Explee", sent: 1091, positives: 2, calls: 0, real_capacity: 120000, total_capacity: 120000, burnt_inboxes: 0, by_brand: { glued: { sent: 1091 }, ds: { sent: 0 } } }] },
  });
}
