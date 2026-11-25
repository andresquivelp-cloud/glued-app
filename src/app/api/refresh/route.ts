import { runSync } from "@/lib/sync";
import { json, personOr401 } from "@/lib/api";

export const maxDuration = 60;

// The refresh button: pull Smartlead and Explee for today (and any days missed).
export async function POST() {
  const u = await personOr401(); if (u instanceof Response) return u;
  return json(await runSync(u.email));
}
