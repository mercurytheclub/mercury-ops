"use client";

import { useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/auth-actions";

type SessionUser = { name?: string | null; email?: string | null; image?: string | null };

// Initials for the monogram fallback when there's no Google photo: first +
// last name initial, else the first letter of the email.
function initialsOf(name: string, email: string): string {
  const n = name.trim();
  if (n) {
    const parts = n.split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }
  return (email.trim()[0] || "·").toUpperCase();
}

// Top-right account control. Reads the SSO session client-side (so pages stay
// statically cached), shows the user's avatar, and opens a menu with their
// profile and sign-out. Renders nothing until a session resolves — so it's
// invisible on the login page and on unauthenticated loads.
export function ProfileMenu() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [open, setOpen] = useState(false);
  const [imgOk, setImgOk] = useState(true);
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

  if (!user) return null;

  const name = (user.name || "").trim();
  const email = (user.email || "").trim();
  const initials = initialsOf(name, email);
  const showImg = !!user.image && imgOk;

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
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image as string}
            alt=""
            className="account-avatar"
            referrerPolicy="no-referrer"
            onError={() => setImgOk(false)}
          />
        ) : (
          <span className="account-avatar account-monogram">{initials}</span>
        )}
      </button>

      {open ? (
        <div className="account-menu" role="menu" ref={menuRef}>
          <div className="account-head">
            {showImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image as string}
                alt=""
                className="account-avatar-lg"
                referrerPolicy="no-referrer"
                onError={() => setImgOk(false)}
              />
            ) : (
              <span className="account-avatar-lg account-monogram">{initials}</span>
            )}
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
