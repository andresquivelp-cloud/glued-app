import { redirect } from "next/navigation";
import { connection } from "next/server";
import { signIn } from "@/auth";
import { currentUser } from "@/lib/session";

// Per-person page: render at request time.
export const instant = false;

// Shopify's login, Google only: one card, the logo, "Log in", one button.
const MESSAGES: Record<string, string> = {
  domain: "Use your company email to log in.",
  invite: "This account hasn't been invited. Contact your admin.",
  inactive: "This account is inactive. Contact your admin.",
  AccessDenied: "This account hasn't been invited. Contact your admin.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string; out?: string }> }) {
  await connection();      // per request: sign-in state and a fresh form token
  const { error, callbackUrl, out } = await searchParams;
  if (!error && (await currentUser())) redirect("/");
  const msg = error ? MESSAGES[error] ?? "Something went wrong. Try again." : null;
  const back = callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f1f1f1] px-4 py-10">
      <div className="w-full max-w-[400px] rounded-2xl bg-white p-8 shadow-[0_1px_0_rgba(0,0,0,.05),0_4px_24px_rgba(0,0,0,.06)] sm:p-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/glide-logo.svg" alt="Glide" width={88} height={20} className="h-5 w-auto" />
        <h1 className="mt-8 text-xl font-semibold tracking-tight text-[#1a1a1a]">Log in</h1>
        <p className="mt-1 text-sm text-[#616161]">Continue to Glide</p>

        {msg && (
          <div role="alert" className="mt-6 flex gap-2 rounded-lg bg-[#fee9e8] px-3 py-2.5 text-sm text-[#8e1f0b]">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-none" fill="currentColor"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-.75 4.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM10 14.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" /></svg>
            <span>{msg}</span>
          </div>
        )}
        {out && !msg && <p role="status" className="mt-6 rounded-lg bg-[#f1f1f1] px-3 py-2.5 text-sm text-[#303030]">You logged out.</p>}

        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: back });
          }}
        >
          <button
            type="submit"
            className="flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] border border-[#d4d4d4] bg-white text-sm font-medium text-[#303030] shadow-[0_1px_0_rgba(0,0,0,.05)] transition hover:bg-[#f7f7f7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#005bd3] active:bg-[#f1f1f1]"
          >
            <svg aria-hidden="true" viewBox="0 0 18 18" className="h-[18px] w-[18px]">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
              <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
            </svg>
            Continue with Google
          </button>
        </form>
        <p className="mt-6 text-xs leading-5 text-[#616161]">Use your @getglued.co account. Only invited people can log in.</p>
      </div>
      <p className="mt-6 text-xs text-[#8a8a8a]">Glide · Glued Co Global</p>
    </main>
  );
}
