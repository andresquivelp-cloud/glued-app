import { auth, isAllowed } from "@/auth";

export type AppUser = { email: string; name: string; image: string | null; pid: string | null };

// The prototype's people, by the part of the email before the @.
const PIDS: Record<string, string> = { andres: "andres", david: "david", daniel: "dan" };

// Local testing only: GLIDE_DEV_USER signs you in without Google. Ignored in production.
const devUser = () => (process.env.NODE_ENV !== "production" ? process.env.GLIDE_DEV_USER : undefined);

export async function currentUser(): Promise<AppUser | null> {
  const dev = devUser();
  if (dev) return toUser(dev, dev.split("@")[0], null);
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !isAllowed(email)) return null;
  return toUser(email, session.user?.name ?? email, session.user?.image ?? null);
}

function toUser(email: string, name: string, image: string | null): AppUser {
  const local = email.toLowerCase().split("@")[0];
  return { email: email.toLowerCase(), name, image, pid: PIDS[local] ?? null };
}

export const isOwner = (u: AppUser | null) => u?.email === "andres@getglued.co";
