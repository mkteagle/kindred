"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { User } from "@/types";

const API = "/api";

/**
 * Shared hook for current user info + role checks.
 * Reads from /api/auth/me and caches via React Query.
 * Also respects the "view as member" admin toggle stored in sessionStorage.
 */
export function useUser() {
  const { data, isLoading } = useQuery<User>({
    queryKey: ["auth-me"],
    queryFn: () => fetch(`${API}/auth/me`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const effectiveRole = useMemo(() => {
    if (!data?.loggedIn) return undefined;
    // "View as member" toggle — purely UI-side, server still treats as real role
    if (typeof window !== "undefined" && data.role === "admin") {
      try {
        const override = sessionStorage.getItem("viewAsRole");
        if (override === "member") return "member" as const;
      } catch {
        /* SSR or sessionStorage unavailable */
      }
    }
    return data.role;
  }, [data]);

  const toggleViewAs = useCallback(() => {
    if (!data?.loggedIn || data.role !== "admin") return;
    try {
      const current = sessionStorage.getItem("viewAsRole");
      if (current === "member") {
        sessionStorage.removeItem("viewAsRole");
      } else {
        sessionStorage.setItem("viewAsRole", "member");
      }
      // Force re-render by dispatching storage event
      window.dispatchEvent(new Event("storage"));
      // Force query refetch to pick up the change
      window.location.reload();
    } catch {
      /* no-op */
    }
  }, [data]);

  return {
    user: data?.loggedIn ? data : null,
    isLoading,
    /** The effective role (respects "view as member" toggle) */
    role: effectiveRole,
    /** The real server role (ignores toggle) */
    realRole: data?.role,
    isAdmin: effectiveRole === "admin",
    isMember: effectiveRole === "member",
    isLoggedIn: !!data?.loggedIn,
    /** Toggle "view as member" mode (admin only) */
    toggleViewAs,
    /** Whether admin is currently viewing as member */
    isViewingAsMember:
      data?.role === "admin" && effectiveRole === "member",
  };
}
