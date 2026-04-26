"use client";

import React, { createContext, useContext, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ToastContainer } from "./toast";
import { useToasts } from "./use-notifications";
import type { ToastItem } from "./use-notifications";

interface ToastCtx {
  addToast: (toast: Omit<ToastItem, "id" | "timestamp">) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastCtx>({
  addToast: () => "",
  dismissToast: () => {},
});

export function useToastContext() {
  return useContext(ToastContext);
}

/**
 * ToastProvider wraps the app and provides:
 * 1. Toast state management
 * 2. Polling for new notifications and showing toasts for new ones
 * 3. Rendering the ToastContainer
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { toasts, addToast, dismissToast, pauseTimer, resumeTimer } = useToasts();
  const qc = useQueryClient();
  const lastSeenIdRef = useRef<number>(0);
  const initializedRef = useRef(false);

  // Poll for new notifications and show toasts when tab is focused
  useEffect(() => {
    // Only show toasts when tab is focused
    const pollInterval = setInterval(async () => {
      if (document.hidden) return;

      try {
        const resp = await fetch("/api/backend/notifications?limit=3");
        const data = await resp.json();
        const items = data.notifications || [];

        if (!initializedRef.current) {
          // On first load, just record the latest ID
          if (items.length > 0) lastSeenIdRef.current = items[0].id;
          initializedRef.current = true;
          return;
        }

        // Show toasts for new items
        for (const item of items) {
          if (item.id > lastSeenIdRef.current) {
            const isAdmin = item.type?.startsWith("admin.");
            addToast({
              type: item.type || "sync",
              title: item.title,
              message: item.message || "",
              autoDismissMs: isAdmin ? 8000 : 5000,
            });
          }
        }

        if (items.length > 0 && items[0].id > lastSeenIdRef.current) {
          lastSeenIdRef.current = items[0].id;
          // Also refresh notification queries
          qc.invalidateQueries({ queryKey: ["notifications"] });
        }
      } catch {
        // silently ignore
      }
    }, 15000);

    return () => clearInterval(pollInterval);
  }, [addToast, qc]);

  return (
    <ToastContext.Provider value={{ addToast, dismissToast }}>
      {children}
      <ToastContainer
        toasts={toasts}
        onDismiss={dismissToast}
        onPause={pauseTimer}
        onResume={resumeTimer}
      />
    </ToastContext.Provider>
  );
}
