"use server";

import { signOut } from "@/auth";

// Sign-out server action for the account menu. Client components can import this
// directly and use it in a <form action={signOutAction}>.
export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
