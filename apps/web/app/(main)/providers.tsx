"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, useRef, Suspense } from "react";
import { initPostHog } from "@/lib/posthog";
import { LightboxProvider } from "@/components/photo-lightbox";

/**
 * Global 401 interceptor — when the backend returns 401 on any /api/* route
 * while the user was previously authenticated, redirect to /login?return=<path>.
 * This addresses finding #6 from the auth-flow audit (no global 401 handler).
 */
function setup401Interceptor() {
  const originalFetch = window.fetch;
  let hadSession = false;

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    // Track whether we've ever had a valid session
    const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url || "";
    if (url.includes("/api/auth/me")) {
      try {
        const clone = response.clone();
        const data = await clone.json();
        if (data.loggedIn) hadSession = true;
      } catch { /* ignore */ }
    }

    // On 401 from any /api/ route, if we previously had a session, redirect
    if (response.status === 401 && url.includes("/api/") && hadSession) {
      const path = window.location.pathname;
      // Don't redirect if already on login/join/reset
      if (!path.startsWith("/login") && !path.startsWith("/join") && !path.startsWith("/reset")) {
        window.location.href = `/login?return=${encodeURIComponent(path)}`;
      }
    }

    return response;
  };
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  const interceptorSet = useRef(false);

  useEffect(() => {
    initPostHog();
    if (!interceptorSet.current) {
      setup401Interceptor();
      interceptorSet.current = true;
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <LightboxProvider>{children}</LightboxProvider>
      </Suspense>
    </QueryClientProvider>
  );
}
