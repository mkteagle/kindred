// Shared app state hoisted into context so every page sees the same polling
// loop, status counts, in-flight list, etc. without each page running its own.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  api,
  events,
  type ScanProgress,
  type StatusCounts,
  type UploadEvent,
} from "./tauri";

type RateSample = { t: number; bytes: number };

export type AppState = {
  counts: StatusCounts;
  running: boolean;
  inFlight: UploadEvent[];
  scanState: ScanProgress | null;
  scanning: boolean;
  setScanning: (v: boolean) => void;
  setScanState: (s: ScanProgress | null) => void;
  rate: { bps: number; eta: number };
  error: string | null;
  setError: (e: string | null) => void;
  // actions
  startUpload: () => Promise<void>;
  stopUpload: () => Promise<void>;
  clearQueue: () => Promise<void>;
};

const Ctx = createContext<AppState | null>(null);

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppState outside AppStateProvider");
  return v;
}

const ZERO_COUNTS: StatusCounts = {
  pending: 0,
  uploading: 0,
  done: 0,
  failed: 0,
  skipped: 0,
  total_bytes_done: 0,
  total_bytes_all: 0,
};

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<StatusCounts>(ZERO_COUNTS);
  const [running, setRunning] = useState(false);
  const [inFlight, setInFlight] = useState<UploadEvent[]>([]);
  const [scanState, setScanState] = useState<ScanProgress | null>(null);
  const [scanning, setScanning] = useState(false);
  const [rate, setRate] = useState({ bps: 0, eta: Infinity });
  const [error, setError] = useState<string | null>(null);
  const ratePoints = useRef<RateSample[]>([]);

  // Single polling loop for the whole app.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [c, r] = await Promise.all([api.getStatus(), api.isRunning()]);
        if (!alive) return;
        setCounts(c);
        setRunning(r);
        // update rolling rate
        const now = Date.now();
        ratePoints.current.push({ t: now, bytes: c.total_bytes_done });
        ratePoints.current = ratePoints.current.filter((p) => now - p.t < 30_000);
        if (ratePoints.current.length >= 2) {
          const oldest = ratePoints.current[0];
          const elapsed = (now - oldest.t) / 1000;
          if (elapsed >= 0.5) {
            const delta = c.total_bytes_done - oldest.bytes;
            const bps = delta / elapsed;
            const remaining = c.total_bytes_all - c.total_bytes_done;
            const eta = bps > 0 ? remaining / bps : Infinity;
            setRate({ bps, eta });
          }
        }
      } catch (_e) {
        /* transient */
      }
    };
    tick();
    const i = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, []);

  // Event subscriptions
  useEffect(() => {
    const unsubs: Promise<() => void>[] = [];
    unsubs.push(
      events.onUploadEvent((e) => {
        setInFlight((prev) => {
          if (e.kind === "start") return [...prev.filter((x) => x.file_id !== e.file_id), e];
          return prev.filter((x) => x.file_id !== e.file_id);
        });
      }),
    );
    unsubs.push(events.onUploadStarted(() => setRunning(true)));
    unsubs.push(
      events.onUploadStopped(() => {
        setRunning(false);
        setInFlight([]);
      }),
    );
    unsubs.push(events.onScanProgress((p) => setScanState(p)));
    unsubs.push(
      events.onScanComplete((p) => {
        setScanState(p);
        setScanning(false);
      }),
    );
    return () => {
      unsubs.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  const value: AppState = {
    counts,
    running,
    inFlight,
    scanState,
    scanning,
    setScanning,
    setScanState,
    rate,
    error,
    setError,
    startUpload: async () => {
      setError(null);
      try {
        await api.startUpload();
      } catch (e) {
        setError(String(e));
      }
    },
    stopUpload: async () => {
      try {
        await api.stopUpload();
      } catch (e) {
        setError(String(e));
      }
    },
    clearQueue: async () => {
      if (
        !confirm(
          "Clear all queued files? Files already uploaded to Flickr stay there; this just resets the local queue.",
        )
      )
        return;
      try {
        await api.clearQueue();
      } catch (e) {
        setError(String(e));
      }
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
