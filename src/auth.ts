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
    signIn({ profile }) {
      return !!profile?.email_verified && isAllowed(profile.email);
    },
    // Runs in proxy.ts on every page: no session, no access.
    authorized({ auth, request }) {
      if (request.nextUrl.pathname.startsWith("/login")) return true;
      return isAllowed(auth?.user?.email);
    },
  },
});
