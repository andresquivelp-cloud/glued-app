export { auth as proxy } from "@/auth";

export const config = {
  // Sign-in protects every page. The token API and the daily job check their own keys.
  matcher: ["/((?!api/auth|api/v1|api/cron|_next/static|_next/image|favicon.ico|icon.svg|glide-logo.svg|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
