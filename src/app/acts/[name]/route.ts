import { currentUser } from "@/lib/session";
import { openSealed, plainResponse, ACTS } from "@/lib/bundle";

// The pop-ups drawn for one Sales screen.
export async function GET(_req: Request, ctx: RouteContext<"/acts/[name]">) {
  if (!(await currentUser())) return new Response("Sign in", { status: 401 });
  const { name } = await ctx.params, n = name.replace(/\.json$/, "");
  if (!ACTS.has(n)) return new Response("Not in this app", { status: 404 });
  return plainResponse(await openSealed(`acts/${n}.json`), "application/json", "private, max-age=600");
}
