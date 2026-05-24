import { useEffect, useState } from "react";
import { useAppState } from "../lib/appState";
import { api, type FileRow, type UploadEvent } from "../lib/tauri";
import { basename } from "../lib/format";
import { PageHeader } from "../components/PageHeader";

// We don't have a persistent event log yet — show recent in-flight events from
// the live stream plus the most recent failures from the DB. Real activity log
// (uploads completed, scans run, etc.) is a future task.

export function ActivityPage() {
  const { inFlight } = useAppState();
  const [recentDone, setRecentDone] = useState<UploadEvent[]>([]);
  const [recentFailures, setRecentFailures] = useState<FileRow[]>([]);

  useEffect(() => {
    const refresh = async () => {
      try {
        const f = await api.listFailed(20);
        setRecentFailures(f);
      } catch (_e) {}
    };
    refresh();
    const i = setInterval(refresh, 5000);
    return () => clearInterval(i);
  }, []);

  // Collect "ok" events into recentDone as they arrive — only since this page
  // was opened. (No persistent event log on the backend yet.)
  useEffect(() => {
    let buffer: UploadEvent[] = [];
    const sub = import("../lib/tauri").then(({ events }) =>
      events.onUploadEvent((e) => {
        if (e.kind === "ok") {
          buffer = [e, ...buffer].slice(0, 40);
          setRecentDone(buffer);
        }
      }),
    );
    return () => {
      sub.then((fn) => fn());
    };
  }, []);

  return (
    <div>
      <PageHeader
        title="Activity"
        subtitle="Live stream of uploads completing, plus a snapshot of the latest failures."
      />

      <div className="px-7 py-6 space-y-6 max-w-[1040px]">
        <section className="card-pad">
          <div className="h-eyebrow">Currently uploading</div>
          {inFlight.length === 0 ? (
            <p className="mt-2" style={{ fontSize: 12.5, color: "var(--color-mist)" }}>
              Nothing in flight right now.
            </p>
          ) : (
            <div className="mt-3 space-y-1">
              {inFlight.map((f) => (
                <ActivityRow
                  key={`flight-${f.file_id}`}
                  tone="ember"
                  title={basename(f.path)}
                  sub={f.path}
                  trail="Uploading"
                />
              ))}
            </div>
          )}
        </section>

        <section className="card-pad">
          <div className="h-eyebrow">Recently uploaded (this session)</div>
          {recentDone.length === 0 ? (
            <p className="mt-2" style={{ fontSize: 12.5, color: "var(--color-mist)" }}>
              No completions yet since you opened Activity. The list fills in as photos finish.
            </p>
          ) : (
            <div className="mt-3 space-y-1">
              {recentDone.map((e) => (
                <ActivityRow
                  key={`done-${e.file_id}`}
                  tone="forest"
                  title={basename(e.path)}
                  sub={e.photo_id ? `Flickr ID ${e.photo_id}` : "Uploaded"}
                  trail="Uploaded"
                />
              ))}
            </div>
          )}
        </section>

        <section className="card-pad">
          <div className="h-eyebrow">Recent failures</div>
          {recentFailures.length === 0 ? (
            <p className="mt-2" style={{ fontSize: 12.5, color: "var(--color-mist)" }}>
              No recent failures.
            </p>
          ) : (
            <div className="mt-3 space-y-1">
              {recentFailures.map((r) => (
                <ActivityRow
                  key={`fail-${r.id}`}
                  tone="rosehip"
                  title={basename(r.path)}
                  sub={r.error ?? ""}
                  trail={`×${r.attempts}`}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ActivityRow({
  tone,
  title,
  sub,
  trail,
}: {
  tone: "ember" | "forest" | "rosehip";
  title: string;
  sub: string;
  trail: string;
}) {
  const colors: Record<typeof tone, { bg: string; dot: string; text: string }> = {
    ember: {
      bg: "rgba(201, 85, 28, 0.06)",
      dot: "var(--color-ember)",
      text: "var(--color-terra)",
    },
    forest: {
      bg: "rgba(47, 74, 54, 0.06)",
      dot: "var(--color-forest)",
      text: "var(--color-forest)",
    },
    rosehip: {
      bg: "rgba(154, 52, 22, 0.06)",
      dot: "var(--color-rosehip)",
      text: "var(--color-rosehip)",
    },
  };
  const c = colors[tone];
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-md"
      style={{ background: c.bg, border: "1px solid var(--line)" }}
    >
      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: c.dot }} />
      <div className="flex-1 min-w-0">
        <div
          className="truncate"
          style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--color-ash)" }}
          title={title}
        >
          {title}
        </div>
        <div
          className="truncate"
          style={{ fontSize: 11, color: "var(--color-mist)", marginTop: 1 }}
          title={sub}
        >
          {sub}
        </div>
      </div>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: c.text,
        }}
      >
        {trail}
      </span>
    </div>
  );
}
