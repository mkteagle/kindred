"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BACKEND } from "@/lib/constants";
import type { User } from "@/types";
import { DocsIcon, EyeIcon, MoonIcon, PersonIcon, QrIcon, SignOutIcon, SunIcon } from "./icons";
import { useTheme } from "./theme";
import { MobileSetupDialog } from "./mobile-setup-dialog";

const API = "/api";

export function initialOf(user: User | null | undefined): string {
  return (user?.display_name || user?.fullname || user?.username || "?").charAt(0).toUpperCase();
}

export function displayNameOf(user: User | null | undefined): string {
  return user?.display_name || user?.fullname || user?.username || "Signed in";
}

/**
 * Avatar button plus its popover. Same item set as the previous topbar menu —
 * account, docs, mobile setup, view-as-member, sign out — with the admin-only
 * entries still gated on the real server role.
 */
export function KxUserMenu({ user }: { user: User | null }) {
  const { theme, toggle: toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const signOutRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (signOutOpen && signOutRef.current && !signOutRef.current.open) signOutRef.current.showModal();
  }, [signOutOpen]);

  const viewingAsMember = (() => {
    try {
      return user?.role === "admin" && sessionStorage.getItem("viewAsRole") === "member";
    } catch {
      return false;
    }
  })();

  const toggleViewAs = () => {
    try {
      if (sessionStorage.getItem("viewAsRole") === "member") sessionStorage.removeItem("viewAsRole");
      else sessionStorage.setItem("viewAsRole", "member");
      window.location.reload();
    } catch {
      /* sessionStorage unavailable */
    }
  };

  const confirmSignOut = async () => {
    await fetch(`${API}/auth/logout`, { method: "POST" });
    window.location.href = "/login";
  };

  if (!user) {
    return (
      // A plain anchor, not next/link: this is an OAuth redirect, not a route.
      // Link prefetches it, and prefetching mints a throwaway Flickr request
      // token on every render the session has not resolved in yet.
      <a href={`${API}/auth/flickr`} className="kx-button primary">
        Connect library
      </a>
    );
  }

  const avatar = user.avatar_url ? `${BACKEND}${user.avatar_url}` : null;

  return (
    <>
      <div className="kx-menu-anchor" ref={anchorRef}>
        {avatar ? (
          <button
            className="kx-avatar"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Your account"
            style={{ padding: 0 }}
          >
            <img src={avatar} alt="" width={34} height={34} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </button>
        ) : (
          <button
            className="kx-avatar"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Your account"
          >
            {initialOf(user)}
          </button>
        )}

        {open && (
          <div className="kx-menu" role="menu">
            <div className="kx-menu-head">
              {avatar ? (
                <span className="kx-avatar lg">
                  <img src={avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </span>
              ) : (
                <span className="kx-avatar lg">{initialOf(user)}</span>
              )}
              <span>
                <strong>{displayNameOf(user)}</strong>
                <span className="kx-mono">
                  @{user.username}
                  {user.role ? ` · ${user.role}` : ""}
                </span>
              </span>
            </div>
            <div className="kx-menu-divider" />

            <Link href="/settings" className="kx-menu-item" role="menuitem" onClick={() => setOpen(false)}>
              <PersonIcon />
              Account settings
            </Link>
            <Link href="/docs" className="kx-menu-item" role="menuitem" onClick={() => setOpen(false)}>
              <DocsIcon />
              Documentation
            </Link>
            {/* Same hook as the topbar button, so the two never disagree. */}
            <button className="kx-menu-item" role="menuitem" onClick={toggleTheme}>
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              {theme === "dark" ? "Light theme" : "Dark theme"}
            </button>

            {user.role === "admin" && (
              <>
                <button
                  className="kx-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setQrOpen(true);
                    setOpen(false);
                  }}
                >
                  <QrIcon />
                  Mobile setup
                </button>
                <div className="kx-menu-divider" />
                <button className="kx-menu-item" role="menuitem" onClick={toggleViewAs}>
                  <EyeIcon />
                  {viewingAsMember ? "Back to admin view" : "View as member"}
                </button>
              </>
            )}

            <div className="kx-menu-divider" />
            <button
              className="kx-menu-item"
              role="menuitem"
              onClick={() => {
                setSignOutOpen(true);
                setOpen(false);
              }}
            >
              <SignOutIcon />
              Sign out
            </button>
          </div>
        )}
      </div>

      {qrOpen && <MobileSetupDialog onClose={() => setQrOpen(false)} />}

      {signOutOpen && (
        <dialog
          ref={signOutRef}
          className="signout-confirm"
          onClose={() => setSignOutOpen(false)}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSignOutOpen(false);
              signOutRef.current?.close();
            }
          }}
        >
          <div className="signout-body">
            <div className="signout-avatar">{initialOf(user)}</div>
            <h3>
              Sign out, <strong>{displayNameOf(user).split(" ")[0]}</strong>?
            </h3>
            <p>You&apos;ll need your password to sign back in. Pending uploads will be saved on this device.</p>
          </div>
          <div className="signout-actions">
            <button
              className="button ghost"
              onClick={() => {
                setSignOutOpen(false);
                signOutRef.current?.close();
              }}
            >
              Stay signed in
            </button>
            <button className="button dark" onClick={confirmSignOut}>
              Sign out
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
