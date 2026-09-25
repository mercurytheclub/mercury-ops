export { auth as middleware } from "@/auth";

// Protect every route EXCEPT: the auth endpoints, the login page, Next internals,
// and the handful of static files the login page itself needs before anyone is signed in.
// Unauthenticated requests to anything else are redirected to /login by the `authorized` callback.
//
// api/ops-identity is excepted as well, and answers for itself. It is called by the n8n ops
// forms to pre-fill "who is doing this", and a form needs a JSON "nobody is signed in" back —
// the blanket redirect would hand it the HTML of the login page instead, which it cannot read
// cross-origin and could only treat as a failure. The route calls auth() itself and tells an
// unauthenticated caller nothing at all.
//
// THE STATIC FILES ARE NAMED, ONE BY ONE, ON PURPOSE.
//
// This used to end `|.*\.(?:png|jpg|svg|mp4|woff|…)$`, which exempts any path ENDING in one of
// those, not any path that is one of those files. So `/forms/<anything>.png` reached the /forms
// proxy with no login at all — the sign-in was keyed on the last four characters of the URL, and
// a URL is chosen by whoever is asking. Nothing was exposed by it, because no n8n webhook path
// ends in an image extension and the proxy simply passed a 404 back, but it was one badly-named
// route or webhook path away from mattering, and it is the wrong shape for an auth rule either
// way. Found while probing the proxy for TK1220 — the probes ran through it unauthenticated.
//
// So: the four files below are everything in public/ plus the two app-dir icon conventions
// (src/app/icon.png, src/app/apple-icon.png). They are exempt because the LOGIN page draws them,
// which is the only reason any asset needs to be reachable before sign-in.
//
// **Adding a file to public/ means adding it here**, or it 302s to the login and renders as a
// broken image. That is deliberate: a new asset failing loudly the first time you load the page
// is cheaper than a rule that quietly lets a whole path shape past the sign-in. Anything bundled
// — CSS, JS, next/font faces — is served from /_next/static and is already covered.
export const config = {
  matcher: [
    "/((?!api/auth|api/ops-identity|login|_next/static|_next/image|favicon\\.ico$|icon\\.png$|apple-icon\\.png$|mercury-logo-white\\.svg$|mercury-white\\.mp4$).*)",
  ],
};
