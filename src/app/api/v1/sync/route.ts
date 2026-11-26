import { runSync } from "@/lib/sync";
import { json, fail, botOk } from "@/lib/api";

export const maxDuration = 300;

export async function POST(req: Request) {
  if (!botOk(req)) return fail("Send Authorization: Bearer <GLIDE_API_TOKEN>", 401);
  const { report } = await runSync("grokbot", { full: new URL(req.url).searchParams.get("full") === "1" });
  return json({ ok: report.some((r) => r.ok), report });
}
