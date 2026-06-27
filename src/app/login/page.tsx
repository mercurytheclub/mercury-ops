import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";
import { Wordmark } from "@/app/components/Wordmark";
import { color } from "@brand";

export const dynamic = "force-dynamic";

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C41 38 44 31.7 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { error } = await searchParams;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.75rem",
        padding: "2rem",
      }}
    >
      <Wordmark size={34} />
      {/* Brand tagline (lowercase, as the brand writes it) — not a repeat of "ops". */}
      <p style={{ fontFamily: "var(--font-mono), monospace", letterSpacing: "0.22em", fontSize: "0.66rem", opacity: 0.4, marginTop: "-0.75rem" }}>
        concierge travel
      </p>

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/?welcome=1" });
        }}
      >
        <button type="submit" className="login-btn">
          <GoogleMark />
          <span>Sign in with Google</span>
        </button>
      </form>

      {error ? (
        <p style={{ color: color.red, fontSize: "0.85rem", maxWidth: "22rem", textAlign: "center" }}>
          {error === "AccessDenied"
            ? "That account isn’t on the Mercury team allowlist. Ask an admin to add your email."
            : "Sign-in failed. Please try again."}
        </p>
      ) : (
        <p style={{ opacity: 0.4, fontSize: "0.8rem" }}>access is limited to the Mercury team.</p>
      )}
    </main>
  );
}
