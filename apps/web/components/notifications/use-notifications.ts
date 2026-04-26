"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND } from "@/lib/constants";
import type { SyncLog } from "@/types";

/* ── Types ────────────────────────────────────────────────────────────── */

export interface NotifItem {
  id: number;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

export interface NotifData {
  notifications: NotifItem[];
  unread_count: number;
}

export interface NotifSettings {
  quietHours: { enabled: boolean; from: string; to: string };
  types: Record<string, {
    push: boolean;
    inbox: boolean;
    frequency: "realtime" | "daily" | "weekly";
    mutedUntil: string | null;
  }>;
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

/** Group notifications by day */
export function groupByDay(items: NotifItem[]): { label: string; items: NotifItem[] }[] {
  const groups: Map<string, NotifItem[]> = new Map();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  for (const item of items) {
    const d = new Date(item.created_at);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let label: string;
    if (dayStart.getTime() === today.getTime()) label = "Today";
    else if (dayStart.getTime() === yesterday.getTime()) label = "Yesterday";
    else label = d.toLocaleDateString("en-US", { month: "long", day: "numeric" });

    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(item);
  }

  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

/** Format a timestamp to short time (e.g. "9:24a") */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? "p" : "a";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")}${suffix}`;
}

/** Format relative time for inbox */
export function relativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ── Hooks ────────────────────────────────────────────────────────────── */

/** Core notifications data hook — used by bell dropdown and inbox */
export function useNotifications(limit = 10) {
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery<NotifData>({
    queryKey: ["notifications", limit],
    queryFn: () => fetch(`${BACKEND}/notifications?limit=${limit}`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const markRead = useCallback(async (id: number) => {
    await fetch(`${BACKEND}/notifications/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([id]),
    });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }, [qc]);

  const markAllRead = useCallback(async () => {
    await fetch(`${BACKEND}/notifications/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(null),
    });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }, [qc]);

  return {
    notifications: data?.notifications || [],
    unreadCount: data?.unread_count || 0,
    isLoading,
    refetch,
    markRead,
    markAllRead,
  };
}

/** Sync history hook — pulls real data from the API */
export function useSyncHistory() {
  return useQuery<SyncLog[]>({
    queryKey: ["syncs"],
    queryFn: () => fetch(`${BACKEND}/syncs`).then((r) => r.json()),
    refetchInterval: 60000,
  });
}

/* ── Toast system ─────────────────────────────────────────────────────── */

export interface ToastItem {
  id: string;
  type: string;
  title: string;
  message: string;
  timestamp: number;
  autoDismissMs: number;
}

/** In-app toast state management */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const addToast = useCallback((toast: Omit<ToastItem, "id" | "timestamp">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newToast: ToastItem = {
      ...toast,
      id,
      timestamp: Date.now(),
    };
    setToasts((prev) => {
      // Max 3 visible
      const next = [newToast, ...prev].slice(0, 3);
      return next;
    });

    // Auto-dismiss
    const timer = setTimeout(() => {
      dismissToast(id);
    }, toast.autoDismissMs);
    timersRef.current.set(id, timer);

    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const pauseTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const resumeTimer = useCallback((id: string, ms: number) => {
    const timer = setTimeout(() => {
      dismissToast(id);
    }, ms);
    timersRef.current.set(id, timer);
  }, [dismissToast]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  return { toasts, addToast, dismissToast, pauseTimer, resumeTimer };
}
