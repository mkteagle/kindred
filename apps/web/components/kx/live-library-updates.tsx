"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";
import type { Pipeline } from "./use-library";

type Worker = { running?: boolean; waiting?: boolean; stale?: boolean; phase?: string; registered?: number; unchanged?: number; completed?: number; counts_authoritative?: boolean };
type EventPayload = { snapshot: Record<string, Worker | null>; counts_changed: boolean; previews_changed: boolean };

export function LiveLibraryUpdates({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    let countsDirty = false;
    let progressDirty = false;
    const flush = () => {
      refresh = undefined;
      if (countsDirty) void queryClient.invalidateQueries({ queryKey: ["library-counts"] });
      if (progressDirty) void queryClient.invalidateQueries({ queryKey: ["pipelines"] });
      countsDirty = false; progressDirty = false;
    };
    const connect = () => {
      source?.close(); source = null;
      if (document.visibilityState === "hidden") return;
      source = new EventSource(`${BACKEND}/library/events`);
      source.addEventListener("progress", event => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as EventPayload;
          queryClient.setQueryData(["library-discovery"], data.snapshot);
          queryClient.setQueryData<{ pipelines: Pipeline[] }>(["pipelines"], old => old ? {
            ...old, pipelines: old.pipelines.map(pipeline => {
              const worker = data.snapshot[pipeline.key === "index" ? "recognition" : pipeline.key];
              if (!worker) return pipeline;
              const done = pipeline.key === "discovery" ? (worker.registered ?? 0) + (worker.unchanged ?? 0)
                : pipeline.key === "previews" && worker.counts_authoritative ? (worker.completed ?? pipeline.done) : pipeline.done;
              const percent = pipeline.total && pipeline.total > 0
                ? done >= pipeline.total ? 100 : Math.min(99.9, Math.round(done / pipeline.total * 1000) / 10) : null;
              return { ...pipeline, phase: worker.phase, stale: !!worker.stale, running: !!worker.running && !worker.stale && !worker.waiting,
                done, percent, remaining: pipeline.total === null ? null : Math.max(0, pipeline.total - done) };
            }),
          } : old);
          countsDirty ||= data.counts_changed;
          progressDirty ||= data.counts_changed || (data.previews_changed && !data.snapshot.previews?.counts_authoritative);
          if ((countsDirty || progressDirty) && !refresh) refresh = setTimeout(flush, 500);
        } catch { /* A truncated event can be recovered by the next snapshot. */ }
      });
    };
    connect();
    document.addEventListener("visibilitychange", connect);
    const fallback = setInterval(() => {
      if (document.visibilityState !== "hidden" && source?.readyState !== EventSource.OPEN) {
        void queryClient.invalidateQueries({ queryKey: ["library-counts"] });
        void queryClient.invalidateQueries({ queryKey: ["pipelines"] });
      }
    }, 30_000);
    return () => { source?.close(); clearInterval(fallback); if (refresh) clearTimeout(refresh); document.removeEventListener("visibilitychange", connect); };
  }, [enabled, queryClient]);
  return null;
}
