"use server";

// Server actions for the concierge inbox.
//
// Every one of these re-checks the session itself. The middleware already
// redirects an unauthenticated PAGE request to /login, but a server action is a
// POST to an endpoint, not a navigation — so it gets its own gate rather than
// inheriting one. These actions send text messages to clients; "the middleware
// probably covered it" is not the standard that deserves.

import { revalidatePath } from "next/cache";
import { auth, isAllowed } from "@/auth";
import {
  claimThread,
  composeMessage,
  redraft,
  saveDraft,
  type ComposeResult,
} from "@/server/concierge";

type Denied = { ok: false; error: string };

/** The signed-in team member, or a refusal. Also the name a claim is stamped with. */
async function requireOps(): Promise<{ ok: true; who: string } | Denied> {
  const session = await auth();
  const email = session?.user?.email ?? null;
  // Pre-auth local dev (AUTH_GOOGLE_ID unset) has no session and the `authorized`
  // callback lets it through, so mirror that here rather than locking dev out.
  if (!process.env.AUTH_GOOGLE_ID) return { ok: true, who: session?.user?.name || "Mercury Ops" };
  if (!email || !isAllowed(email)) return { ok: false, error: "You are not signed in to ops." };
  return { ok: true, who: session?.user?.name || email };
}

/** Save the concierge's edit to the draft without sending anything. */
export async function saveDraftAction(input: {
  threadId: string;
  messageId: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireOps();
  if (!gate.ok) return gate;
  const res = await saveDraft(input.messageId, input.text);
  if (res.ok) revalidatePath(`/inbox/${input.threadId}`);
  return res;
}

/**
 * Send a message to the guest. This is the one that texts a real person.
 *
 * Addressed to the THREAD, not to a particular inbound message, so a concierge
 * can follow up, correct themselves, or write first. The old shape allowed one
 * reply per text the guest sent and then refused with "this one has already
 * gone out".
 */
export async function sendMessageAction(input: {
  threadId: string;
  text: string;
}): Promise<ComposeResult> {
  const gate = await requireOps();
  if (!gate.ok) return gate;
  const res = await composeMessage(input.threadId, input.text);
  revalidatePath(`/inbox/${input.threadId}`);
  revalidatePath("/inbox");
  return res;
}

/** Ask Claude for the draft again. Never sends. */
export async function redraftAction(input: {
  threadId: string;
  messageId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireOps();
  if (!gate.ok) return gate;
  const res = await redraft(input.messageId);
  // The draft is written in the background after the route answers, so the row
  // will say "Drafting" for a moment. The page revalidates either way; the UI
  // tells the user to expect the wait.
  if (res.ok) revalidatePath(`/inbox/${input.threadId}`);
  return res;
}

/** Put your name on a thread, or take it off (`release`). */
export async function claimThreadAction(input: {
  threadId: string;
  release?: boolean;
}): Promise<{ ok: boolean; error?: string; who?: string | null }> {
  const gate = await requireOps();
  if (!gate.ok) return gate;
  const who = input.release ? null : gate.who;
  const res = await claimThread(input.threadId, who);
  if (res.ok) {
    revalidatePath(`/inbox/${input.threadId}`);
    revalidatePath("/inbox");
  }
  return { ...res, who };
}
