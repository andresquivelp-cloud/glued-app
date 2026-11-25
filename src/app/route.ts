import { currentUser } from "@/lib/session";
import { openSealed } from "@/lib/bundle";
import { gunzipSync } from "node:zlib";

// The Sales app: the prototype's Sales screens, opened for the person signed in.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return Response.redirect(new URL("/login", req.url), 302);
  const html = gunzipSync(await openSealed("index.html")).toString("utf8");
  const me = JSON.stringify(user).replace(/</g, "\\u003c");
  const page = html.replace("/*__GLIDE_USER__*/{}", me);
  return new Response(page, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex", "x-frame-options": "DENY", "referrer-policy": "same-origin" },
  });
}
