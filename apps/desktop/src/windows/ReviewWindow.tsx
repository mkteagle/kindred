// Window 3 — Review session. 980×660.
//
// "Who is this?" — the unnamed clusters, largest group first, with a name
// field, the reuse chips, and the ↵ / M / S / X action stack. Every one of
// those is a bare key, so they are DOM listeners and are suspended while the
// name field has focus: typing "Sam" must not skip three faces.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Eyebrow, Kbd, QuietEyebrow, TitleBar } from "../desktop/Chrome";
import { Placeholder } from "../desktop/Browse";
import { formatCount } from "../lib/format";
import {
  library,
  type Cluster,
  type ClusterDetail,
  type NamedCluster,
} from "../lib/library";

type ReviewParams = { category?: string; clusterId?: string };

export function ReviewWindow({ params }: { params: ReviewParams }) {
  const category = params.category ?? "people";
  const [queue, setQueue] = useState<Cluster[]>([]);
  const [named, setNamed] = useState<NamedCluster[]>([]);
  const [position, setPosition] = useState(0);
  const [detail, setDetail] = useState<ClusterDetail | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const current = queue[position] ?? null;

  /* ── Load the queue ─────────────────────────────────────────────────── */

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      library.clusters(category, { limit: 200 }),
      library.namedClusters(category),
    ])
      .then(([summary, namedClusters]) => {
        // Unnamed only, largest first — the summary is already ordered by
        // detection count, which is the same "biggest group first" promise.
        const unnamed = summary.clusters.filter((c) => !c.label);
        setQueue(
          params.clusterId
            ? [
                ...summary.clusters.filter((c) => c.id === params.clusterId),
                ...unnamed.filter((c) => c.id !== params.clusterId),
              ]
            : unnamed,
        );
        setNamed(namedClusters);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [category, params.clusterId]);

  useEffect(load, [load]);

  useEffect(() => {
    setName("");
    setDetail(null);
    if (!current) return;
    let live = true;
    library
      .clusterDetail(category, current.id)
      .then((d) => live && setDetail(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [current, category]);

  /* ── Actions ────────────────────────────────────────────────────────── */

  const advance = useCallback(() => {
    setPosition((p) => p + 1);
  }, []);

  const run = useCallback(
    async (work: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        // Server-confirmed: the queue only moves on once the write lands.
        await work();
        advance();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, advance],
  );

  const saveName = useCallback(() => {
    const trimmed = name.trim();
    if (!current || !trimmed) return;
    void run(() => library.labelCluster(category, current.id, trimmed));
  }, [current, category, name, run]);

  const mergeInto = useCallback(
    (target: NamedCluster) => {
      if (!current) return;
      // Folding one group into another moves every face in it. Cheap to ask,
      // and a misclick on a chip is easy to make.
      if (!confirm(`Merge these ${current.det_count} faces into ${target.label}?`)) return;
      void run(() => library.mergeClusters(category, current.id, target.id));
    },
    [current, category, run],
  );

  const notAPerson = useCallback(() => {
    if (!current) return;
    // This is the one genuinely destructive action in the window: the server
    // deletes the detections and remembers the average face so similar ones are
    // rejected in future.
    if (
      !confirm(
        `Discard this group of ${current.det_count} faces? Kindred will stop suggesting faces like it.`,
      )
    ) {
      return;
    }
    void run(() => library.dismissCluster(category, current.id));
  }, [current, category, run]);

  /* ── Bare keys ──────────────────────────────────────────────────────── */

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const active = document.activeElement;
      const typing =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (event.key === "Enter") {
        // ↵ saves whether or not the field has focus — that is the point of it.
        event.preventDefault();
        saveName();
        return;
      }
      if (typing) return;
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        advance();
      } else if (event.key === "x" || event.key === "X") {
        event.preventDefault();
        notAPerson();
      } else if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        nameRef.current?.focus();
        setError("Pick a name below to merge into.");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveName, advance, notAPerson]);

  const remaining = Math.max(0, queue.length - position);
  const faces = detail?.items ?? [];
  const shown = faces.slice(0, 8);
  const overflow = Math.max(0, (current?.det_count ?? faces.length) - shown.length);

  const suggestions = useMemo(() => named.slice(0, 6), [named]);

  return (
    <div className="k-root">
      <TitleBar title={`Review — ${formatCount(remaining)} to name`} />
      <div className="k-body">
        <div
          style={{
            width: 300,
            flex: "none",
            borderRight: "1px solid var(--k-line)",
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            overflowY: "auto",
          }}
        >
          <Eyebrow>Review</Eyebrow>
          <span
            style={{
              width: "100%",
              aspectRatio: "1",
              borderRadius: 999,
              background: "var(--k-tile)",
              overflow: "hidden",
            }}
          >
            {current?.avatar ? (
              <img
                src={current.avatar}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : null}
          </span>
          <span className="k-mono-11" style={{ textAlign: "center" }}>
            {current
              ? `${formatCount(current.photo_count)} photos · ${formatCount(current.det_count)} faces`
              : "Nothing left in the queue"}
          </span>

          <input
            ref={nameRef}
            className="k-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this person"
            aria-label="Name this person"
            disabled={!current || busy}
            style={{
              height: 38,
              padding: "0 12px",
              borderRadius: "var(--k-radius)",
              background: "var(--k-fill)",
              border: "1px solid var(--k-line-2)",
              fontFamily: "var(--font-display)",
              fontSize: 15,
              letterSpacing: 0,
            }}
          />

          {suggestions.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {suggestions.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className="k-pill k-pill-name"
                  onClick={() => mergeInto(person)}
                  disabled={!current || busy}
                  title={`Merge this group into ${person.label}`}
                >
                  {person.label}
                </button>
              ))}
            </div>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 4 }}>
            <Button
              variant="primary"
              style={{ height: 36 }}
              onClick={saveName}
              disabled={!current || busy || !name.trim()}
            >
              Save name <Kbd>↵</Kbd>
            </Button>
            <Button
              style={{ height: 34 }}
              onClick={() => nameRef.current?.focus()}
              disabled={!current || busy}
            >
              Merge into… <Kbd>M</Kbd>
            </Button>
            <Button style={{ height: 34 }} onClick={advance} disabled={!current || busy}>
              Skip <Kbd>S</Kbd>
            </Button>
            <Button
              variant="danger"
              style={{ height: 34 }}
              onClick={notAPerson}
              disabled={!current || busy}
            >
              Not a person <Kbd>X</Kbd>
            </Button>
          </div>
          {error ? (
            <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--k-danger-ink)" }}>
              {error}
            </p>
          ) : null}
        </div>

        <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div
            style={{
              flex: "none",
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "12px 18px",
              borderBottom: "1px solid var(--k-line)",
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <strong style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600 }}>
                Who is this?
              </strong>
              <span className="k-mono">
                {formatCount(position + 1)} of {formatCount(queue.length)} · largest group first
              </span>
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <Button
                onClick={() => {
                  // Singles are the long tail: one face seen once. Skipping
                  // them all at once is the only way through 705 of them.
                  const next = queue.findIndex(
                    (cluster, at) => at > position && cluster.det_count > 1,
                  );
                  setPosition(next < 0 ? queue.length : next);
                }}
              >
                Skip all singles
              </Button>
              <Button onClick={load}>Refresh queue</Button>
            </span>
          </div>

          {loading ? (
            <Placeholder title="Loading the queue…" />
          ) : !current ? (
            <Placeholder
              title="Everyone is named"
              body="Nothing is waiting in this queue. New faces appear here after the next index."
            />
          ) : (
            <div className="k-scroll" style={{ flex: "1 1 auto", padding: "14px 16px" }}>
              <QuietEyebrow>Faces in this group · click to remove</QuietEyebrow>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, margin: "9px 0 18px" }}>
                {shown.map((face) => (
                  <button
                    key={face.id}
                    type="button"
                    title="Remove this face from the group"
                    onClick={() =>
                      void library
                        .removeDetections(category, current.id, [face.id])
                        .then(() =>
                          library.clusterDetail(category, current.id).then(setDetail),
                        )
                        .catch((e) => setError(String(e)))
                    }
                    style={{
                      width: 58,
                      height: 58,
                      padding: 0,
                      border: "none",
                      borderRadius: 7,
                      overflow: "hidden",
                      background: "var(--k-tile)",
                    }}
                  >
                    {face.chip ? (
                      <img
                        src={face.chip}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : null}
                  </button>
                ))}
                {overflow > 0 ? (
                  <span
                    className="k-mono"
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 7,
                      background: "var(--k-fill-3)",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    +{formatCount(overflow)}
                  </span>
                ) : null}
              </div>

              <QuietEyebrow>Possible duplicate</QuietEyebrow>
              <div
                className="k-card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: 14,
                  marginTop: 9,
                }}
              >
                {/* TODO: the similarity score the design shows ("91% similar")
                    has no endpoint. /duplicates compares *photos* by CLIP
                    distance, not face clusters. A `/clusters/{category}/similar`
                    returning candidate pairs with a distance would close this;
                    until then the reuse chips above are the merge route. */}
                <span className="k-mono" style={{ maxWidth: 460, lineHeight: 1.6 }}>
                  Suggested merges need a cluster-similarity endpoint. Use the name chips on
                  the left to merge this group into someone already named.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
