"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/auth-actions";

type SessionUser = { name?: string | null; email?: string | null };

// Simple line-art person glyph — head + shoulders, hairline stroke, inherits
// currentColor so the trigger can dim/brighten it. No photo, no fill.
function PersonIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="9" r="3.4" />
      <path d="M5.6 18.6c0-3.4 2.7-5.7 6.4-5.7s6.4 2.3 6.4 5.7" />
    </svg>
  );
}

// Top-right account control. Reads the SSO session client-side (so pages stay
// statically cached) and opens a menu with the signed-in profile and sign-out.
// Hidden on the login page (it lives in the root layout, so it persists across
// the sign-out navigation and would otherwise keep stale session state) and
// until a session resolves.
export function ProfileMenu() {
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => {
        if (alive && s?.user) setUser(s.user as SessionUser);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Close on outside click or Escape; focus the first item when opening.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (pathname === "/login" || !user) return null;

  const name = (user.name || "").trim();
  const email = (user.email || "").trim();

  return (
    <div className="account" ref={wrapRef}>
      <button
        type="button"
        className={`account-trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
      >
        <PersonIcon className="account-icon" />
      </button>

      {open ? (
        <div className="account-menu" role="menu" ref={menuRef}>
          <div className="account-head">
            <span className="account-head-avatar">
              <PersonIcon className="account-icon-lg" />
            </span>
            <div className="account-id">
              {name ? <span className="account-name">{name}</span> : null}
              {email ? <span className="account-email">{email}</span> : null}
            </div>
          </div>

          <div className="account-rule" />

          <a
            href="https://myaccount.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="account-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <span>Google account</span>
            <span className="account-item-ext" aria-hidden>
              ↗
            </span>
          </a>

          <form action={signOutAction}>
            <button type="submit" className="account-item account-item-btn" role="menuitem">
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
