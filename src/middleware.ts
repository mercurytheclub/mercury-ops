export { auth as middleware } from "@/auth";

// Protect every route EXCEPT: the auth endpoints, the login page, Next internals,
// and static asset files (logo, loader video, fonts, icons). Unauthenticated
// requests to anything else are redirected to /login by the `authorized` callback.
export const config = {
  matcher: [
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|mp4|ico|woff|woff2|ttf)$).*)",
  ],
};
