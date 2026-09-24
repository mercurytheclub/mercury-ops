import { auth } from "@/auth";
import { opsPersonForSession } from "@/server/opsTeam";

/**
 * The ops forms, behind the sign-in that already guards this app.
 *
 * An ops form lives in n8n and is opened by a human clicking a button field in Airtable. A plain
 * navigation carries no secret, which is why the `Gate: Key` pattern could never protect one and
 * why ~107 of them answer anybody who has the URL. This route is the missing piece: the browser
 * asks mercury-ops, mercury-ops already knows who it is talking to, and only then does the form
 * get fetched — server side, where a key can be carried.
 *
 *     /forms/air-flight-form?x=1   →   <N8N>/webhook/air-flight-form?x=1
 *
 * Everything under /forms is covered by the middleware matcher, so an unauthenticated request is
 * redirected to /login and never reaches this code.
 *
 * **The rewrite is load-bearing.** The form pages address n8n by absolute URL and submit with
 * fetch(). Served from this origin and left alone, every one of those calls would go straight
 * back to n8n — around the sign-in for writes, and into a CORS wall for reads. So absolute n8n
 * webhook URLs in the response body are rewritten to /forms/…, which keeps the whole of a form's
 * traffic on this side of the login.
 *
 * Nothing here closes the direct n8n URLs. They stay open until somebody gates them, and this
 * route existing does not change that — it only makes a protected way in possible. Cutting over
 * means gating the webhooks and repointing the Airtable buttons, in that order, and is not
 * something to do quietly on a Tuesday.
 */

const N8N = "https://matthewbecker.app.n8n.cloud";
const N8N_HOST = "matthewbecker.app.n8n.cloud";

/**
 * Proof to n8n that a request came through this route, so a form can refuse to render to anyone
 * else and bounce them here instead.
 *
 * That bounce is how the old URLs get closed without hunting down every link to them. 42 of the
 * form endpoints are not reachable from any Airtable field, and a couple of dozen are referenced
 * by nothing findable at all — bookmarks, interface buttons, cards posted months ago. A form that
 * 404s the moment it is gated breaks all of those silently. A form that redirects keeps every one
 * of them working: the old link bounces through the login and arrives.
 *
 * Unlike the mcyfrm_ key this is never printed in a page, so it cannot be lifted off one.
 */
const PROXY_SECRET = process.env.OPS_PROXY_SECRET ?? "";

// Only bodies we might have to rewrite are worth buffering as text.
const TEXTUAL = /^(text\/|application\/(javascript|json|xhtml))/i;

// Hop-by-hop and length headers must not be copied through: the body is re-encoded here, so a
// forwarded content-length or content-encoding describes something that no longer exists.
const DROP_UPSTREAM = new Set([
  "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive",
]);

/**
 * n8n answers every webhook with `Content-Security-Policy: sandbox …` and no `allow-same-origin`.
 * Copied onto this origin it puts the form in an opaque origin, where localStorage throws and a
 * same-origin fetch is treated as cross-origin from a null origin. That silently kills both ways
 * the form has of learning who is filling it in — the remembered name and /api/ops-identity —
 * and it is why the first gated form still asked, despite the lookup working.
 *
 * The sandbox is kept, because the page is still HTML this app did not write; it is only allowed
 * to be its own origin. Everything else n8n asked for stays.
 */
function sameOriginSandbox(csp: string): string {
  return csp
    .split(";")
    .map((directive) => {
      const d = directive.trim();
      if (!/^sandbox\b/i.test(d) || /\ballow-same-origin\b/i.test(d)) return directive;
      return `${d} allow-same-origin`;
    })
    .join(";");
}

function upstreamUrl(path: string[], search: string) {
  const suffix = path.map(encodeURIComponent).join("/");
  return `${N8N}/webhook/${suffix}${search}`;
}

/**
 * Point the page's own absolute n8n URLs back at this route.
 *
 * No trailing slash in what is matched, and the protocol-relative spelling too. The pages hold
 * the bare prefix as well as full URLs — the key-injecting wrapper every form ships opens with
 * `var H='https://<host>/webhook'` — and a single missed spelling is a fetch that goes straight
 * to n8n around the sign-in. Which is exactly what the first version of this did.
 */
function rewrite(body: string) {
  return body
    .split(`https://${N8N_HOST}/webhook`).join("/forms")
    .split(`http://${N8N_HOST}/webhook`).join("/forms")
    .split(`//${N8N_HOST}/webhook`).join("/forms");
}

/**
 * Tell the page who opened it, so it can say "logged by Rick" instead of asking. A meta tag
 * rather than a header: the page's own script can read it with no extra request, and a form
 * reached the old way simply does not find one and asks as it always did.
 */
function stampUser(html: string, name: string | null, why: string) {
  const clean = (v: string) => v.replace(/[&<>"]/g, "");
  // The reason is stamped even when there is a name, because "it works on my form" and "it works
  // for that person" are different questions and both get asked. Diagnosing this without it meant
  // guessing from a screenshot at which of four things had gone wrong.
  const tag = `<meta name="mercury-ops-user" content="${clean(name ?? "")}">`
            + `<meta name="mercury-ops-why" content="${clean(why)}">`;
  const head = html.indexOf("<head>");
  if (head < 0) return html;
  return html.slice(0, head + 6) + tag + html.slice(head + 6);
}

async function proxy(req: Request, path: string[]) {
  let why = "matched";
  let whoAmI: string | null = null;
  try {
    const session = await auth();
    if (!session?.user) {
      why = "no-session-in-proxy";
    } else {
      const person = await opsPersonForSession(session.user);
      if (person) whoAmI = person.name;
      else why = "signed-in-but-not-on-the-roster";
    }
  } catch (e) {
    why = "lookup-threw: " + (e instanceof Error ? e.message.slice(0, 80) : "unknown");
  }

  const search = new URL(req.url).search;
  const headers = new Headers();
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  headers.set("accept", req.headers.get("accept") ?? "*/*");
  // Who is asking, for anything upstream that wants to record it. Not a credential: the form
  // pages are still reachable directly, so nothing upstream may trust this to mean anything.
  if (whoAmI) headers.set("x-ops-user", whoAmI);
  if (PROXY_SECRET) headers.set("x-ops-proxy", PROXY_SECRET);

  const method = req.method.toUpperCase();
  const init: RequestInit = { method, headers, redirect: "manual" };
  if (method !== "GET" && method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  let res: Response;
  try {
    res = await fetch(upstreamUrl(path, search), init);
  } catch {
    return new Response("The form did not answer. Try again in a moment.", {
      status: 502, headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const out = new Headers();
  res.headers.forEach((v, k) => {
    const key = k.toLowerCase();
    if (DROP_UPSTREAM.has(key)) return;
    out.set(k, key === "content-security-policy" ? sameOriginSandbox(v) : v);
  });
  out.set("cache-control", "no-store, private");

  const type = res.headers.get("content-type") ?? "";
  if (!TEXTUAL.test(type)) {
    // A PDF, an image, anything binary: hand it back untouched.
    return new Response(res.body, { status: res.status, headers: out });
  }

  let body = rewrite(await res.text());
  if (/^text\/html/i.test(type)) body = stampUser(body, whoAmI, why);
  return new Response(body, { status: res.status, headers: out });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: Request, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
