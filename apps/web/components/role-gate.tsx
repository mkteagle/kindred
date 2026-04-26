"use client";

import type { ReactNode } from "react";
import { useUser } from "@/lib/use-user";

/**
 * Conditionally renders children based on the user's effective role.
 * Hidden != disabled — admin tools simply don't render for members.
 */
export function RoleGate({
  role,
  children,
}: {
  role: "admin";
  children: ReactNode;
}) {
  const { role: effectiveRole, isLoading } = useUser();
  if (isLoading) return null;
  if (effectiveRole !== role) return null;
  return <>{children}</>;
}

/**
 * Inverse gate — renders children only for members (or when admin is viewing as member).
 */
export function MemberOnly({ children }: { children: ReactNode }) {
  const { isMember, isLoading } = useUser();
  if (isLoading) return null;
  if (!isMember) return null;
  return <>{children}</>;
}
