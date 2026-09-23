export { auth as middleware } from "@/auth";

// Protect every route EXCEPT: the auth endpoints, the login page, Next internals,
// and static asset files (logo, loader video, fonts, icons). Unauthenticated
// requests to anything else are redirected to /login by the `authorized` callback.
//
// api/ops-identity is excepted as well, and answers for itself. It is called by the n8n ops
// forms to pre-fill "who is doing this", and a form needs a JSON "nobody is signed in" back —
// the blanket redirect would hand it the HTML of the login page instead, which it cannot read
// cross-origin and could only treat as a failure. The route calls auth() itself and tells an
// unauthenticated caller nothing at all.
export const config = {
  matcher: [
    "/((?!api/auth|api/ops-identity|login|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|mp4|ico|woff|woff2|ttf)$).*)",
  ],
};
