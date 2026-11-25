import { readFile } from "node:fs/promises";
import path from "node:path";
import { createDecipheriv } from "node:crypto";
import { gunzipSync } from "node:zlib";
import manifest from "../../bundle/manifest.json";

// The Sales screens, sealed with AES-256-GCM (the repo is public). BUNDLE_KEY opens them.
// Each file is: 12-byte IV, ciphertext, 16-byte tag. Inside is gzip.
const ROOT = path.join(process.cwd(), "bundle");

export const STILLS = new Set<string>(manifest.stills);
export const ACTS = new Set<string>(manifest.acts);

export async function openSealed(file: string): Promise<Buffer> {
  const key = process.env.BUNDLE_KEY;
  if (!key || key.length !== 64) throw new Error("BUNDLE_KEY is not set");
  const raw = await readFile(path.join(ROOT, file + ".enc"));
  const iv = raw.subarray(0, 12), tag = raw.subarray(raw.length - 16), body = raw.subarray(12, raw.length - 16);
  const d = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]);
}

// Sent as plain bytes: the platform compresses responses itself (a hand-set content-encoding gets dropped on the way).
export function plainResponse(gz: Buffer, type: string, cache = "private, no-store") {
  return new Response(new Uint8Array(gunzipSync(gz)), {
    headers: { "content-type": type, "cache-control": cache, "x-robots-tag": "noindex", vary: "Cookie" },
  });
}
