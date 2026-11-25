import { readDoc } from "@/lib/store";
import { json, personOr401 } from "@/lib/api";

// Everything the Sales screens read: every day, the projections and when each source last synced.
export async function GET() {
  const u = await personOr401(); if (u instanceof Response) return u;
  return json(await readDoc());
}
