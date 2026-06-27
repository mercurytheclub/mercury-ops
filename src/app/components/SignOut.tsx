import { signOut } from "@/auth";

// Server-action sign-out. Rendered globally; harmless on the login page (no
// session). Doesn't read the session, so it won't force dynamic rendering.
export function SignOut() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
      className="signout-form"
    >
      <button type="submit" className="signout-btn label" aria-label="Sign out">
        sign out
      </button>
    </form>
  );
}
