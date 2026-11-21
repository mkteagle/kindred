"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { User } from "@/types";

const API = "/api";
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

/**
 * Shared hook for current user info + role checks.
 * Reads from /api/auth/me and caches via React Query.
 */
export function useUser() {
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const { data: cachedUser, isLoading } = useQuery<User>({
    queryKey: ["auth-me"],
    enabled: hydrated,
    queryFn: () => fetch(`${API}/auth/me`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const data = hydrated ? cachedUser : undefined;

  const role = data?.loggedIn ? data.role : undefined;

  return {
    user: data?.loggedIn ? data : null,
    isLoading: !hydrated || isLoading,
    role,
    isAdmin: role === "admin",
    isMember: role === "member",
    isLoggedIn: !!data?.loggedIn,
  };
}
