import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Comma-separated list of people allowed in, set in Vercel as ALLOWED_EMAILS.
const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export function isAllowed(email?: string | null) {
  return !!email && allowedEmails.includes(email.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: { params: { prompt: "select_account", hd: "getglued.co" } },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    // Only verified Google accounts on the allowlist can sign in.
    // Wrong domain and not invited get their own message on the login page.
    signIn({ profile }) {
      const email = (profile?.email ?? "").toLowerCase();
      if (!profile?.email_verified || !email.endsWith("@getglued.co")) return "/login?error=domain";
      if (!isAllowed(email)) return "/login?error=invite";
      return true;
    },
    // Runs in proxy.ts on every page: no session, no access.
    authorized({ auth, request }) {
      const p = request.nextUrl.pathname;
      if (p.startsWith("/login")) return true;
      if (p.startsWith("/api/")) return true;      // API routes answer 401 themselves, as JSON
      if (process.env.NODE_ENV !== "production" && process.env.GLIDE_DEV_USER) return true;      // local testing only
      return isAllowed(auth?.user?.email);
    },
  },
});
