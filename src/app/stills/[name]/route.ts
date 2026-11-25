import { currentUser } from "@/lib/session";
import { openSealed, plainResponse, STILLS } from "@/lib/bundle";

// One Sales screen. Only the Sales screens are in the bundle.
export async function GET(_req: Request, ctx: RouteContext<"/stills/[name]">) {
  if (!(await currentUser())) return new Response("Sign in", { status: 401 });
  const { name } = await ctx.params, n = name.replace(/\.json$/, "");
  if (!STILLS.has(n)) return new Response("Not in this app", { status: 404 });
  return plainResponse(await openSealed(`stills/${n}.json`), "application/json", "private, max-age=600");
}
