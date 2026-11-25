export { auth as proxy } from "@/auth";

export const config = {
  // Protect everything except the auth routes and static files.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
