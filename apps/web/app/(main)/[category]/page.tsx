"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useInfiniteQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button, Spinner } from "@/components/ui";
import { ClusterCard } from "@/components/cluster-card";
import { KxClusterBrowse } from "@/components/kx/cluster-browse";
import { ChevronDownIcon, CloseIcon, SearchIcon } from "@/components/kx/icons";
import { KxErrorBanner, KxSkeletonCards } from "@/components/kx/states";
import Link from "next/link";
import { MergeDialog } from "@/components/dialogs";
import { ReviewMode } from "@/components/review-mode";
import type {
  ClustersSummaryResponse,
  ClusterSummary,
  ClusterDetail,
  Detection,
  SearchResult,
  Stats,
  SyncLog,
  Job,
} from "@/types";
import { BACKEND, CATEGORIES, fmt, toBackendCategory } from "@/lib/constants";
import { useLightbox } from "@/components/photo-lightbox";
import type { LightboxPhoto } from "@/components/photo-lightbox";
import { useUser } from "@/lib/use-user";
import { useToastContext } from "@/components/notifications";
import { photoThumb, faceThumb } from "@/lib/photo-url";

const API = "/api";

/* ── Single unmatched face card ───────────────────────────────────── */

function UnmatchedFaceCard({
  item,
  category,
  allClusters,
  onAssign,
  onDismiss,
  onNewName,
}: {
  item: Detection;
  category: string;
  allClusters: ClusterSummary[];
  onAssign: (detectionId: string, targetClusterId: string) => void;
  onDismiss: (detectionId: string) => void;
  onNewName: (detectionId: string, name: string) => void;
}) {
  const [mergeOpen, setMergeOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (naming) inputRef.current?.focus(); }, [naming]);

  return (
    <div className="unmatched-card">
      <img
        src={faceThumb(item)}
        alt=""
        className="unmatched-chip"
        onClick={() => window.open(item.flickr_url || item.photo_url, "_blank")}
      />
      {naming ? (
        <div className="unmatched-name-input">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) { onNewName(item.id, draft.trim()); setNaming(false); }
              if (e.key === "Escape") setNaming(false);
            }}
            placeholder="Name..."
          />
          <button className="unmatched-name-save" onClick={() => { if (draft.trim()) { onNewName(item.id, draft.trim()); setNaming(false); } }}>
            &#10003;
          </button>
        </div>
      ) : (
        <div className="unmatched-actions">
          <button className="unmatched-btn" onClick={() => setMergeOpen(true)} title="Assign to existing person">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          </button>
          <button className="unmatched-btn" onClick={() => { setDraft(""); setNaming(true); }} title="Create new person">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
      )}
      {mergeOpen && (
        <MergeDialog
          open={true}
          onClose={() => setMergeOpen(false)}
          onSelect={(targetId) => { onAssign(item.id, targetId); setMergeOpen(false); }}
          sourceCluster={{ id: item.id, label: "Unmatched face", det_count: 1, photo_count: 1, avatar: item.chip } as ClusterSummary}
          clusters={allClusters}
        />
      )}
    </div>
  );
}

/* ── Unmatched faces section ──────────────────────────────────────── */

interface UnmatchedData {
  items: Detection[];
  count: number;
}

function UnmatchedSection({
  category,
  count,
  allClusters,
  onAssigned,
}: {
  category: string;
  count: number;
  allClusters: ClusterSummary[];
  onAssigned: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const qc = useQueryClient();
  const { addToast } = useToastContext();
  const bCat = toBackendCategory(category);

  const { data, isLoading } = useQuery<UnmatchedData>({
    queryKey: ["unmatched", category],
    queryFn: () => fetch(`${BACKEND}/clusters/${bCat}/unmatched`).then((r) => r.json()),
    enabled: expanded,
  });

  const items = data?.items || [];

  const handleAssign = async (detectionId: string, targetClusterId: string) => {
    setAssigningId(null);
    const target = allClusters.find((c) => c.id === targetClusterId);
    const targetName = target?.label || "cluster";
    qc.setQueryData<UnmatchedData>(["unmatched", category], (old) => {
      if (!old) return old;
      return { ...old, items: old.items.filter((i) => i.id !== detectionId), count: old.count - 1 };
    });
    try {
      const resp = await fetch(`${BACKEND}/clusters/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: bCat, detection_id: detectionId, target_cluster_id: targetClusterId }),
      });
      if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
      addToast({ type: "activity", title: `Assigned to "${targetName}"`, message: "Detection moved to group", autoDismissMs: 3000 });
      onAssigned();
    } catch (e) {
      addToast({ type: "activity", title: "Failed to assign", message: String(e), autoDismissMs: 5000 });
      qc.invalidateQueries({ queryKey: ["unmatched"] }); // Restore on error
    }
  };

  const handleDismissSingle = async (detectionId: string) => {
    qc.setQueryData<UnmatchedData>(["unmatched", category], (old) => {
      if (!old) return old;
      return { ...old, items: old.items.filter((i) => i.id !== detectionId), count: old.count - 1 };
    });
    try {
      const resp = await fetch(`${BACKEND}/clusters/dismiss-detection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: bCat, detection_id: detectionId }),
      });
      if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
      addToast({ type: "activity", title: "Detection dismissed", message: "Unmatched face removed", autoDismissMs: 3000 });
      onAssigned();
    } catch (e) {
      addToast({ type: "activity", title: "Failed to dismiss", message: String(e), autoDismissMs: 5000 });
      qc.invalidateQueries({ queryKey: ["unmatched"] }); // Restore on error
    }
  };

  const [clustering, setClustering] = useState(false);

  const recluster = async () => {
    setClustering(true);
    try {
      const resp = await fetch(`${BACKEND}/cluster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: bCat, eps: 0.65, min_samples: 2 }),
      });
      if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
      addToast({ type: "admin", title: "Re-clustering complete", message: "Unmatched faces regrouped", autoDismissMs: 4000 });
      qc.invalidateQueries({ queryKey: ["unmatched"] });
      onAssigned();
    } catch (e) {
      addToast({ type: "admin", title: "Re-clustering failed", message: String(e), autoDismissMs: 5000 });
    } finally {
      setClustering(false);
    }
  };

  return (
    <section style={{ marginTop: 24 }}>
      <div className="content-head" style={{ marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>{fmt.format(count)} unmatched faces</h3>
          <p style={{ margin: "4px 0 0", color: "var(--mist)", fontSize: 13 }}>
            Faces seen only once. Re-cluster to group them, or assign manually.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Button small variant="primary" onClick={recluster} disabled={clustering}>
            {clustering ? "Clustering..." : "Re-cluster"}
          </Button>
          <Button small variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Hide" : "Show all"}
          </Button>
        </div>
      </div>

      {expanded && isLoading && (
        <div style={{ textAlign: "center", padding: 24 }}><Spinner /></div>
      )}

      {expanded && !isLoading && items.length > 0 && (
        <div className="unmatched-grid">
          {items.map((item) => (
            <UnmatchedFaceCard
              key={item.id}
              item={item}
              category={category}
              allClusters={allClusters}
              onAssign={handleAssign}
              onDismiss={handleDismissSingle}
              onNewName={async (detectionId: string, name: string) => {
                // Create a new cluster with this name and assign the detection
                try {
                  const newClusterId = crypto.randomUUID();
                  const assignResp = await fetch(`${BACKEND}/clusters/assign`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ category: bCat, detection_id: detectionId, target_cluster_id: newClusterId }),
                  });
                  if (!assignResp.ok) throw new Error(`Assign failed: ${assignResp.status}`);
                  const labelResp = await fetch(`${BACKEND}/clusters/label`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ category: bCat, cluster_id: newClusterId, name }),
                  });
                  if (!labelResp.ok) throw new Error(`Label failed: ${labelResp.status}`);
                  qc.setQueryData<UnmatchedData>(["unmatched", category], (old) => {
                    if (!old) return old;
                    return { ...old, items: old.items.filter((i) => i.id !== detectionId), count: old.count - 1 };
                  });
                  addToast({ type: "activity", title: `Created "${name}"`, message: "New group created and detection assigned", autoDismissMs: 3000 });
                  onAssigned();
                } catch (e) {
                  addToast({ type: "activity", title: "Failed to create group", message: String(e), autoDismissMs: 5000 });
                  qc.invalidateQueries({ queryKey: ["unmatched"] });
                }
              }}
            />
          ))}
        </div>
      )}

      {expanded && !isLoading && items.length === 0 && (
        <p style={{ color: "var(--mist)", fontSize: 13 }}>No unmatched faces.</p>
      )}
    </section>
  );
}

/* ── Virtualized Grid ─────────────────────────────────────────────── */

function VirtualizedGrid({
  items,
  category,
  onDismiss,
  onLabel,
  onMerge,
  onRemoveDetections,
  allClusters,
  processingIds,
  gridSelecting,
  gridSelected,
  onGridToggle,
}: {
  items: ClusterSummary[];
  category: string;
  onDismiss: (cat: string, id: string) => void;
  onLabel: (cat: string, id: string, name: string) => void;
  onMerge: (cat: string, src: string, tgt: string) => void;
  onRemoveDetections: (cat: string, id: string, dets: string[]) => void;
  allClusters: ClusterSummary[];
  processingIds: Set<string>;
  gridSelecting: boolean;
  gridSelected: Set<string>;
  onGridToggle: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const gridGap = 12;
  const minCardWidth = 250;
  const [box, setBox] = useState({ width: 0, top: 0 });
  useLayoutEffect(() => {
    const node = parentRef.current;
    const scroller = node?.closest<HTMLElement>(".kx-content");
    if (!node || !scroller) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const top = rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      setBox(previous => previous.width === rect.width && Math.abs(previous.top - top) < 1
        ? previous : { width: rect.width, top });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.parentElement) observer.observe(node.parentElement);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(1, Math.floor((box.width + gridGap) / (minCardWidth + gridGap)));
  const virtualizer = useVirtualizer({
    count: Math.ceil(items.length / columns),
    getScrollElement: () => parentRef.current?.closest<HTMLElement>(".kx-content") ?? null,
    estimateSize: () => category === "people" ? 116 : 250,
    getItemKey: index => items[index * columns]?.id ?? index,
    overscan: 3,
    gap: gridGap,
    scrollMargin: box.top,
  });
  useEffect(() => { virtualizer.measure(); }, [columns, virtualizer]);

  return (
    <div ref={parentRef}>
      <section
        aria-label="Groups"
        className="kx-managed-groups"
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const startIdx = virtualRow.index * columns;
          const rowItems = items.slice(startIdx, startIdx + columns);

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="kx-managed-grid"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: gridGap,
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${virtualRow.start - box.top}px)`,
              }}
            >
              {rowItems.map((cluster) => (
                <ClusterCard
                  key={cluster.id}
                  category={category}
                  cluster={cluster}
                  onDismiss={onDismiss}
                  onLabel={onLabel}
                  onMerge={onMerge}
                  onRemoveDetections={onRemoveDetections}
                  allClusters={allClusters}
                  processing={processingIds.has(cluster.id)}
                  gridSelecting={gridSelecting}
                  gridSelected={gridSelected.has(cluster.id)}
                  onGridToggle={onGridToggle}
                />
              ))}
            </div>
          );
        })}
      </section>
    </div>
  );
}

export default function CategoryPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const categoryParam = (params.category as string) || "people";
  const qc = useQueryClient();
  const { isAdmin: isEffectiveAdmin } = useUser();
  const { addToast } = useToastContext();
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [activeCategory, setActiveCategory] = useState(categoryParam);
  const [managing, setManaging] = useState(false);
  const backendCat = toBackendCategory(activeCategory);
  const [search, setSearch] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const groupByVisual = searchParams.get("group") === "visual";

  // Debounce filter input for server-side search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilter(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const [clustering, setClustering] = useState(false);
  const [gridSelecting, setGridSelecting] = useState(false);
  const [gridSelected, setGridSelected] = useState<Set<string>>(new Set());
  const gridRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
  }>({ startX: 0, startY: 0, active: false });
  const [dragRect, setDragRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search input for CLIP search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // CLIP text-to-image search
  const { data: clipResults, isLoading: clipLoading } = useQuery<SearchResult[]>({
    queryKey: ["clip-search", debouncedSearch],
    queryFn: () =>
      fetch(`${BACKEND}/search?q=${encodeURIComponent(debouncedSearch)}&limit=30`).then(
        (r) => r.json()
      ),
    enabled: managing && debouncedSearch.length > 2,
  });

  // Sync activeCategory with URL param when navigating
  useEffect(() => {
    setActiveCategory(categoryParam);
  }, [categoryParam]);

  // Drag-to-select on the grid
  useEffect(() => {
    if (!gridSelecting) return;

    const getCardsInRect = (rect: {
      x: number;
      y: number;
      w: number;
      h: number;
    }) => {
      const grid = gridRef.current;
      if (!grid) return new Set<string>();
      const selLeft = Math.min(rect.x, rect.x + rect.w);
      const selTop = Math.min(rect.y, rect.y + rect.h);
      const selRight = Math.max(rect.x, rect.x + rect.w);
      const selBottom = Math.max(rect.y, rect.y + rect.h);

      const hit = new Set<string>();
      grid.querySelectorAll<HTMLElement>("[data-cluster-id]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (
          r.right > selLeft &&
          r.left < selRight &&
          r.bottom > selTop &&
          r.top < selBottom
        ) {
          hit.add(el.dataset.clusterId!);
        }
      });
      return hit;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const grid = gridRef.current;
      if (!grid || !grid.contains(e.target as Node)) return;
      if (!(e.target instanceof Element) || !e.target.closest(".kx-managed-groups")) return;
      if (e.target.closest("button, input")) return;
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startY: e.clientY, active: true };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      const rect = {
        x: Math.min(dragRef.current.startX, e.clientX),
        y: Math.min(dragRef.current.startY, e.clientY),
        w: Math.abs(dx),
        h: Math.abs(dy),
      };
      setDragRect(rect);
      const hit = getCardsInRect(rect);
      setGridSelected(hit);
    };

    const onMouseUp = () => {
      dragRef.current.active = false;
      setDragRect(null);
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [gridSelecting]);

  const PAGE_SIZE = 30;
  const {
    data: summaryPages,
    isLoading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<ClustersSummaryResponse>({
    queryKey: ["clusters-summary", activeCategory, groupByVisual, debouncedFilter],
    queryFn: async ({ pageParam = 0, signal }) => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(pageParam));
      if (groupByVisual) params.set("sort_visual", "true");
      if (debouncedFilter) params.set("q", debouncedFilter);
      const response = await fetch(`${BACKEND}/clusters/${backendCat}/summary?${params}`, { signal });
      if (!response.ok) throw new Error("These groups could not be loaded.");
      return response.json();
    },
    enabled: managing,
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? (lastPage.offset ?? 0) + PAGE_SIZE : undefined,
  });

  // Flatten pages into a single summary-like object
  const summary = useMemo(() => {
    if (!summaryPages?.pages?.length) return null;
    const allClusters = summaryPages.pages.flatMap((p) => p.clusters);
    const lastPage = summaryPages.pages[summaryPages.pages.length - 1];
    return {
      clusters: allClusters,
      noise_count: summaryPages.pages[0]?.noise_count,
      labels: summaryPages.pages[0]?.labels,
      total: lastPage?.total,
    } as ClustersSummaryResponse & { total?: number };
  }, [summaryPages]);

  const { data: stats } = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: () =>
      fetch(`${BACKEND}/stats`).then((response) => response.json()),
    enabled: managing,
  });

  const { data: syncs } = useQuery<SyncLog[]>({
    queryKey: ["syncs"],
    queryFn: () =>
      fetch(`${BACKEND}/syncs`).then((response) => response.json()),
    enabled: managing,
    refetchInterval: scanning ? 5000 : false,
  });

  const activeInfo =
    CATEGORIES.find((item) => item.id === activeCategory) || CATEGORIES[0];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["clusters-summary"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    qc.invalidateQueries({ queryKey: ["syncs"] });
  };

  useEffect(() => {
    if (!jobId) return undefined;
    const events = new EventSource(`${BACKEND}/jobs/${jobId}/stream`);
    events.onmessage = (event) => {
      try {
        const nextJob: Job = JSON.parse(event.data);
        setJob(nextJob);
        if (nextJob.status === "done" || nextJob.status === "error") {
          events.close();
          setScanning(false);
          invalidate();
        }
      } catch {
        // ignore parse errors
      }
    };
    events.onerror = () => {
      events.close();
      setScanning(false);
      invalidate();
    };
    return () => events.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const startScan = async () => {
    setScanning(true);
    setScanStatus("Looking through your Flickr library...");
    setJob(null);
    try {
      const resp = await fetch(`${API}/flickr/user/me/photos?all=true`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const photos: unknown[] = data.photos || [];
      if (!photos.length) {
        setScanStatus("No photos found.");
        setScanning(false);
        addToast({ type: "sync", title: "No photos found", message: "Your library appears empty", autoDismissMs: 4000 });
        return;
      }
      setScanStatus(
        `Found ${fmt.format(photos.length)} photos. Starting analysis...`
      );
      addToast({ type: "sync", title: "Scan started", message: `Analyzing ${fmt.format(photos.length)} photos`, autoDismissMs: 4000 });
      const analyzeResp = await fetch(`${API}/flickr/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos }),
      });
      const result: { job_id: string } = await analyzeResp.json();
      setJobId(result.job_id);
      setJob({
        status: "running",
        progress: 0,
        total: photos.length,
        message: "Starting analysis...",
        counts: { people: 0, pets: 0, vehicles: 0 },
      });
    } catch (error) {
      setScanStatus(`Error: ${(error as Error).message}`);
      setScanning(false);
      addToast({ type: "sync", title: "Scan failed", message: (error as Error).message, autoDismissMs: 5000 });
    }
  };

  const labelCluster = async (
    category: string,
    clusterId: string,
    name: string
  ) => {
    setProcessingIds(prev => new Set(prev).add(clusterId));
    try {
      const resp = await fetch(`${BACKEND}/clusters/label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: toBackendCategory(category), cluster_id: clusterId, name }),
      });
      if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
      addToast({ type: "activity", title: `Named "${name}"`, message: `${activeInfo.singular} updated`, autoDismissMs: 3000 });
      invalidate();
    } catch (e) {
      addToast({ type: "activity", title: "Failed to rename", message: String(e), autoDismissMs: 5000 });
    } finally {
      setProcessingIds(prev => { const next = new Set(prev); next.delete(clusterId); return next; });
    }
  };

  const buildGroups = async () => {
    setClustering(true);
    try {
      const resp = await fetch(`${BACKEND}/cluster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: backendCat,
          eps: 0.65,
          min_samples: 2,
        }),
      });
      if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
      addToast({ type: "admin", title: "Groups built", message: `${activeInfo.label} grouped successfully`, autoDismissMs: 4000 });
      invalidate();
    } catch (e) {
      addToast({ type: "admin", title: "Failed to build groups", message: String(e), autoDismissMs: 5000 });
    } finally {
      setClustering(false);
    }
  };

  const [reclassifying, setReclassifying] = useState(false);
  const reclassifySpecies = async () => {
    setReclassifying(true);
    try {
      const resp = await fetch(`${BACKEND}/clusters/clean-species?category=${backendCat}`, {
        method: "POST",
      });
      if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
      addToast({ type: "admin", title: "Species reclassified", message: "Labels updated from model", autoDismissMs: 4000 });
      invalidate();
    } catch (e) {
      addToast({ type: "admin", title: "Failed to reclassify", message: String(e), autoDismissMs: 5000 });
    } finally {
      setReclassifying(false);
    }
  };

  const handleDismiss = async (category: string, clusterId: string) => {
    // Capture cluster name before optimistic removal
    const cluster = summary?.clusters.find((c) => c.id === clusterId);
    const clusterName = cluster?.label || `Unnamed ${activeInfo.singular}`;
    setProcessingIds(prev => new Set(prev).add(clusterId));
    qc.setQueryData<ClustersSummaryResponse>(
      ["clusters-summary", category],
      (old) => {
        if (!old) return old;
        return {
          ...old,
          clusters: old.clusters.filter((c) => c.id !== clusterId),
        };
      }
    );
    try {
      const resp = await fetch(`${BACKEND}/clusters/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: toBackendCategory(category), cluster_id: clusterId }),
      });
      if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
      addToast({ type: "activity", title: `Dismissed "${clusterName}"`, message: "Removed from library", autoDismissMs: 3000 });
      invalidate();
    } catch (e) {
      addToast({ type: "activity", title: "Failed to dismiss", message: String(e), autoDismissMs: 5000 });
      invalidate(); // Refetch to restore state on error
    } finally {
      setProcessingIds(prev => { const next = new Set(prev); next.delete(clusterId); return next; });
    }
  };

  const handleMerge = async (
    category: string,
    sourceId: string,
    targetId: string
  ) => {
    const target = summary?.clusters.find((c) => c.id === targetId);
    const targetName = target?.label || `Unnamed ${activeInfo.singular}`;
    setProcessingIds(prev => { const next = new Set(prev); next.add(sourceId); next.add(targetId); return next; });
    qc.setQueryData<ClustersSummaryResponse>(
      ["clusters-summary", category],
      (old) => {
        if (!old) return old;
        const source = old.clusters.find((c) => c.id === sourceId);
        return {
          ...old,
          clusters: old.clusters
            .filter((c) => c.id !== sourceId)
            .map((c) =>
              c.id === targetId && source
                ? {
                    ...c,
                    det_count: c.det_count + source.det_count,
                    photo_count: c.photo_count + source.photo_count,
                  }
                : c
            ),
        };
      }
    );
    try {
      const resp = await fetch(`${BACKEND}/clusters/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: toBackendCategory(category),
          source_id: sourceId,
          target_id: targetId,
        }),
      });
      if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
      addToast({ type: "activity", title: `Merged into "${targetName}"`, message: "Groups combined", autoDismissMs: 3000 });
      invalidate();
    } catch (e) {
      addToast({ type: "activity", title: "Failed to merge", message: String(e), autoDismissMs: 5000 });
      invalidate(); // Refetch to restore state on error
    } finally {
      setProcessingIds(prev => { const next = new Set(prev); next.delete(sourceId); next.delete(targetId); return next; });
    }
  };

  const handleRemoveDetections = async (
    category: string,
    clusterId: string,
    detectionIds: string[]
  ) => {
    const idSet = new Set(detectionIds);
    setProcessingIds(prev => new Set(prev).add(clusterId));
    qc.setQueryData<ClusterDetail>(
      ["cluster-detail", category, clusterId],
      (old) => {
        if (!old) return old;
        return { ...old, items: old.items.filter((i) => !idSet.has(i.id)) };
      }
    );
    qc.setQueryData<ClustersSummaryResponse>(
      ["clusters-summary", category],
      (old) => {
        if (!old) return old;
        return {
          ...old,
          clusters: old.clusters.map((c) =>
            c.id === clusterId
              ? { ...c, det_count: c.det_count - detectionIds.length }
              : c
          ),
        };
      }
    );
    try {
      const resp = await fetch(`${BACKEND}/clusters/remove-detections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: toBackendCategory(category),
          cluster_id: clusterId,
          detection_ids: detectionIds,
        }),
      });
      if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
      addToast({ type: "activity", title: `Removed ${detectionIds.length} detection${detectionIds.length > 1 ? "s" : ""}`, message: "Detections removed from group", autoDismissMs: 3000 });
      invalidate();
    } catch (e) {
      addToast({ type: "activity", title: "Failed to remove detections", message: String(e), autoDismissMs: 5000 });
      invalidate(); // Refetch to restore state on error
    } finally {
      setProcessingIds(prev => { const next = new Set(prev); next.delete(clusterId); return next; });
    }
  };

  // Keep a stable sort order — only re-sort when the cluster list fundamentally changes
  // (items added/removed), not when counts update from merge/dismiss
  const sortOrderRef = useRef<string[]>([]);

  const sorted = useMemo(() => {
    const clusters = summary?.clusters || [];
    const currentIds = new Set(clusters.map((c) => c.id));
    const prevIds = new Set(sortOrderRef.current);

    // Only re-sort if items were added or removed
    const needsResort =
      sortOrderRef.current.length === 0 ||
      clusters.length !== sortOrderRef.current.length ||
      [...currentIds].some((id) => !prevIds.has(id));

    let ordered: typeof clusters;
    if (groupByVisual) {
      // Backend already sorted: named first, unnamed by visual similarity
      ordered = clusters;
      sortOrderRef.current = ordered.map((c) => c.id);
    } else if (needsResort) {
      ordered = [...clusters].sort((a, b) => {
        const aNamed = a.label ? 0 : 1;
        const bNamed = b.label ? 0 : 1;
        if (aNamed !== bNamed) return aNamed - bNamed;
        return b.det_count - a.det_count;
      });
      sortOrderRef.current = ordered.map((c) => c.id);
    } else {
      // Keep existing order, just update the data
      const clusterMap = new Map(clusters.map((c) => [c.id, c]));
      ordered = sortOrderRef.current
        .map((id) => clusterMap.get(id))
        .filter((c): c is ClusterSummary => c !== undefined);
    }

    return ordered;
  }, [summary?.clusters, search, activeInfo.singular]);

  const namedClusters = sorted.filter((c) => c.label);
  const unnamedClusters = sorted.filter((c) => !c.label);
  const hasClusters = sorted.length > 0;
  const [namedCollapsed, setNamedCollapsed] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  if (!managing) {
    return <KxClusterBrowse category={activeCategory} onManage={() => setManaging(true)} />;
  }

  return (
    <div className="kx-managed-view kx-task-surface">
      <main className="kx-page" ref={gridRef}>
        <button className="kx-manage-back" onClick={() => setManaging(false)}>
          ← Back to {activeInfo.label.toLowerCase()}
        </button>
        <div className="kx-pagehead kx-manage-head">
          <div>
            <h1 className="kx-title">{`Manage ${activeInfo.label.toLowerCase()}`}</h1>
            {stats?.[backendCat] && (
              <p className="kx-lede">
                {fmt.format(stats[backendCat].detections || 0)} detections across {fmt.format(stats[backendCat].photos || 0)} photos
              </p>
            )}
          </div>
          <label className="kx-people-search">
            <SearchIcon size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Find a named ${activeInfo.singular}`}
              aria-label={`Find a named ${activeInfo.singular}`}
            />
            {search && (
              <button className="kx-iconbutton" type="button" onClick={() => setSearch("")} aria-label="Clear search">
                <CloseIcon size={16} />
              </button>
            )}
          </label>
        </div>
        {isEffectiveAdmin && scanning && (
          <section className="scan-card">
            <div className="scan-top">
              <Spinner />
              <strong>
                {job ? "Analyzing your photos" : scanStatus}
              </strong>
            </div>
            {job ? (
              <>
                <div
                  className="progress"
                  aria-label="Scan progress"
                >
                  <div
                    style={{
                      width: `${
                        job.total
                          ? Math.round((job.progress / job.total) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <div className="scan-meta">
                  <span>{job.message}</span>
                  <span>
                    {fmt.format(job.progress)}/{fmt.format(job.total)}
                  </span>
                </div>
                {job.counts && (
                  <div className="scan-counts">
                    <span>{fmt.format(job.counts.people)} faces</span>
                    <span>{fmt.format(job.counts.pets)} pets</span>
                    <span>{fmt.format(job.counts.vehicles)} vehicles</span>
                  </div>
                )}
              </>
            ) : (
              <p style={{ color: "var(--muted)", margin: 0 }}>
                {scanStatus}
              </p>
            )}
          </section>
        )}

        {summaryLoading && <KxSkeletonCards count={8} minWidth={250} height={110} />}
        {summaryError && !hasClusters && (
          <KxErrorBanner detail={summaryError.message} onRetry={() => void refetchSummary()} />
        )}

        {!summaryLoading && !summaryError && !scanning && !hasClusters && (
          <div className="empty-state">
            <div>
              <h2>
                {search
                  ? "No matching groups"
                  : (summary?.noise_count ?? 0) > 0
                    ? `${fmt.format(
                        summary!.noise_count!
                      )} detections are waiting to be grouped`
                    : activeInfo.empty}
              </h2>
              <p>
                {search
                  ? "Try a different name or clear the search."
                  : (summary?.noise_count ?? 0) > 0
                    ? `The scan found ${activeInfo.label.toLowerCase()}, but they are not clustered into ${activeInfo.cards} yet.`
                    : "Run a scan to analyze the library and create grouped cards here."}
              </p>
              {!search && (summary?.noise_count ?? 0) > 0 ? (
                <Button
                  variant="primary"
                  onClick={buildGroups}
                  disabled={clustering}
                >
                  {clustering ? (
                    <Spinner />
                  ) : (
                    <span className="icon">+</span>
                  )}
                  {clustering ? "Building groups" : "Build groups"}
                </Button>
              ) : (
                isEffectiveAdmin &&
                !search && (
                  <Button variant="primary" onClick={startScan}>
                    <span className="icon">+</span>
                    Scan photos
                  </Button>
                )
              )}
            </div>
          </div>
        )}

        {!summaryLoading && hasClusters && (
          <>
            <div className="grid-toolbar" aria-label="Management actions" role="group">
              {activeCategory === "people" && <Link href="/review/names" className="kx-button">Suggested names</Link>}
              {isEffectiveAdmin && (
                <>
                  {unnamedClusters.length > 0 && (
                    <Button small variant="primary" onClick={() => setReviewOpen(true)}>
                      Review unnamed
                    </Button>
                  )}
                  <details className="kx-recognition-tools">
                    <summary className="kx-button">Recognition tools <ChevronDownIcon size={14} /></summary>
                    <div className="kx-recognition-menu">
                      <Button
                        small
                        variant={groupByVisual ? "primary" : "ghost"}
                        onClick={() => {
                          const newParams = new URLSearchParams(searchParams.toString());
                          if (groupByVisual) {
                            newParams.delete("group");
                          } else {
                            newParams.set("group", "visual");
                          }
                          sortOrderRef.current = [];
                          router.replace(`/${activeCategory}?${newParams.toString()}`, { scroll: false });
                        }}
                      >
                        {groupByVisual ? "Grouped by similarity" : "Group similar"}
                      </Button>
                      <Button small variant="ghost" onClick={buildGroups} disabled={clustering}>
                        {clustering ? "Reclustering..." : "Recluster"}
                      </Button>
                      {activeCategory === "animals" && (
                        <Button small variant="primary" onClick={reclassifySpecies} disabled={reclassifying}>
                          {reclassifying ? "Reclassifying..." : "Reclassify species"}
                        </Button>
                      )}
                    </div>
                  </details>
                </>
              )}
              {isEffectiveAdmin && gridSelecting ? (
                <Button
                  small
                  variant="ghost"
                  onClick={() => {
                    setGridSelecting(false);
                    setGridSelected(new Set());
                  }}
                >
                  Done
                </Button>
              ) : isEffectiveAdmin ? (
                <Button
                  small
                  variant="ghost"
                  onClick={() => setGridSelecting(true)}
                >
                  Select
                </Button>
              ) : null}
              {isEffectiveAdmin && gridSelecting && (
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--muted)",
                    fontWeight: 600,
                  }}
                >
                  {gridSelected.size} selected
                </span>
              )}
              {isEffectiveAdmin && gridSelecting && gridSelected.size > 0 && (
                <>
                  <Button
                    small
                    variant="danger"
                    onClick={() => {
                      gridSelected.forEach((id) =>
                        handleDismiss(activeCategory, id)
                      );
                      setGridSelected(new Set());
                      setGridSelecting(false);
                    }}
                  >
                    Dismiss {gridSelected.size}
                  </Button>
                  <Button
                    small
                    variant="ghost"
                    onClick={() => {
                      const ids = [...gridSelected];
                      const target = ids[0];
                      ids
                        .slice(1)
                        .forEach((id) =>
                          handleMerge(activeCategory, id, target)
                        );
                      setGridSelected(new Set());
                      setGridSelecting(false);
                    }}
                  >
                    Merge {gridSelected.size} together
                  </Button>
                </>
              )}
              {isEffectiveAdmin && gridSelecting && (
                <>
                  <Button
                    small
                    variant="ghost"
                    onClick={() => {
                      setGridSelected(
                        new Set(
                          sorted
                            .filter((c) => !c.label)
                            .map((c) => c.id)
                        )
                      );
                    }}
                  >
                    Select all unnamed
                  </Button>
                  <Button
                    small
                    variant="ghost"
                    onClick={() => setGridSelected(new Set())}
                  >
                    Clear
                  </Button>
                </>
              )}
            </div>
            {/* Named people — collapsible */}
            {namedClusters.length > 0 && (
              <h2 className="kx-manage-section">
                <button className="kx-manage-section-toggle" type="button" aria-expanded={!namedCollapsed}
                  onClick={() => setNamedCollapsed(!namedCollapsed)}>
                  <ChevronDownIcon size={14} /> Named <span>{fmt.format(namedClusters.length)}</span>
                </button>
              </h2>
            )}

            {!namedCollapsed && namedClusters.length > 0 && (
              <VirtualizedGrid
                items={namedClusters}
                category={activeCategory}
                onDismiss={handleDismiss}
                onLabel={labelCluster}
                onMerge={handleMerge}
                onRemoveDetections={handleRemoveDetections}
                allClusters={summary?.clusters || []}
                processingIds={processingIds}
                gridSelecting={gridSelecting}
                gridSelected={gridSelected}
                onGridToggle={(id) => {
                  setGridSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
              />
            )}

            {/* Unnamed people */}
            {unnamedClusters.length > 0 && (
              <h2 className="kx-manage-section">
                Needs a name <span>{fmt.format(unnamedClusters.length)}</span>
              </h2>
            )}

            <VirtualizedGrid
              items={unnamedClusters}
              category={activeCategory}
              onDismiss={handleDismiss}
              onLabel={labelCluster}
              onMerge={handleMerge}
              onRemoveDetections={handleRemoveDetections}
              allClusters={summary?.clusters || []}
              processingIds={processingIds}
              gridSelecting={gridSelecting}
              gridSelected={gridSelected}
              onGridToggle={(id) => {
                setGridSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
            />

            {/* Infinite scroll trigger */}
            {hasNextPage && (
              <div
                ref={(el) => {
                  if (!el) return;
                  const observer = new IntersectionObserver(
                    (entries) => { if (entries[0]?.isIntersecting && !summaryError) void fetchNextPage({ cancelRefetch: false }); },
                    { root: el.closest(".kx-content"), rootMargin: "400px" }
                  );
                  observer.observe(el);
                  return () => observer.disconnect();
                }}
                style={{ textAlign: "center", padding: 24 }}
              >
                {isFetchingNextPage ? <Spinner /> : (
                  <Button small variant="ghost" onClick={() => void fetchNextPage({ cancelRefetch: false })}>
                    Load more
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        {isEffectiveAdmin && (summary?.noise_count ?? 0) > 0 && (
          <UnmatchedSection
            category={activeCategory}
            count={summary!.noise_count!}
            allClusters={summary?.clusters || []}
            onAssigned={invalidate}
          />
        )}

        {debouncedSearch.length > 2 && (
          <section style={{ marginTop: 32 }}>
            <h2 className="kx-manage-section">Matching photos</h2>
            {clipLoading ? (
              <div className="empty-state" style={{ minHeight: 180 }}>
                <Spinner />
              </div>
            ) : clipResults && clipResults.length > 0 ? (
              <div className="clip-results-grid">
                {clipResults.map((result) => (
                  <a
                    key={result.photo_id}
                    href={result.flickr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="clip-result-card"
                  >
                    <img
                      src={photoThumb(result)}
                      alt={result.photo_title || "Search result"}
                    />
                    <div className="clip-result-info">
                      <span className="clip-result-title">
                        {result.photo_title || "Untitled"}
                      </span>
                      <span className="clip-result-score">
                        {Math.round((1 - result.distance) * 100)}% match
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ minHeight: 180 }}>
                <div>
                  <h2>No photo matches</h2>
                  <p>No photos matched your search query.</p>
                </div>
              </div>
            )}
          </section>
        )}

      </main>

      {isEffectiveAdmin && reviewOpen && unnamedClusters.length > 0 && (
        <ReviewMode
          category={activeCategory}
          clusters={unnamedClusters}
          allClusters={summary?.clusters || []}
          onDismiss={handleDismiss}
          onLabel={labelCluster}
          onMerge={handleMerge}
          onRemoveDetections={handleRemoveDetections}
          onDeleteDetection={async (detectionId: string) => {
            try {
              const resp = await fetch(`${BACKEND}/detections/delete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ detection_id: detectionId }),
              });
              if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
              addToast({ type: "activity", title: "Detection removed", message: "Photo detection deleted", autoDismissMs: 3000 });
              qc.invalidateQueries({ queryKey: ["cluster-detail"] });
              invalidate();
            } catch (e) {
              addToast({ type: "activity", title: "Failed to delete detection", message: String(e), autoDismissMs: 5000 });
            }
          }}
          onClose={() => { setReviewOpen(false); invalidate(); }}
        />
      )}

      {dragRect && (
        <div
          className="drag-rect"
          style={{
            left: dragRect.x,
            top: dragRect.y,
            width: dragRect.w,
            height: dragRect.h,
          }}
        />
      )}
    </div>
  );
}
