import { runSync } from "@/lib/sync";
import { json, fail, cronOk } from "@/lib/api";

export const maxDuration = 60;

// Vercel runs this every morning (vercel.json), so the numbers move even on days nobody presses refresh.
export async function GET(req: Request) {
  if (!cronOk(req)) return fail("Not allowed", 401);
  const { report } = await runSync("cron");
  return json({ ok: true, report });
}
