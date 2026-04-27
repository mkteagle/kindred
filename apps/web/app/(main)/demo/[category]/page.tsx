"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getDemoCategory, DEMO_STATS, type DemoCluster } from "../demo-data";

const fmt = new Intl.NumberFormat();

export default function DemoCategoryPage() {
  const params = useParams();
  const categoryId = (params.category as string) || "people";
  const catInfo = getDemoCategory(categoryId);
  const [search, setSearch] = useState("");

  if (!catInfo) {
    return (
      <div className="app-shell">
        <main className="page">
          <div className="empty-state">
            <div>
              <h2>Category not found</h2>
              <p>The category &ldquo;{categoryId}&rdquo; doesn&apos;t exist in this demo.</p>
              <Link href="/demo" className="button primary" style={{ textDecoration: "none", marginTop: 12, display: "inline-block" }}>
                Back to library
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const statsKey = categoryId as keyof typeof DEMO_STATS;
  const stats = DEMO_STATS[statsKey];

  const filtered = useMemo(() => {
    if (!search.trim()) return catInfo.clusters;
    const q = search.toLowerCase();
    return catInfo.clusters.filter((c) => c.label.toLowerCase().includes(q));
  }, [catInfo.clusters, search]);

  return (
    <div className="app-shell">
      <main className="page">
        <section className="control-band" aria-label="Browse controls">
          <div className="toolbar">
            <label className="search">
              <span aria-hidden="true">Search</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Find a named ${catInfo.singular}`}
              />
              {search && (
                <button className="search-clear" type="button" onClick={() => setSearch("")} aria-label="Clear search">
                  &times;
                </button>
              )}
            </label>
          </div>
        </section>

        <div className="content-head">
          <div>
            <h2>{catInfo.label}</h2>
            <p>
              {categoryId === "people"
                ? "Tap a card to see the matching photos."
                : "Groups detected and organized from your photo library."}
            </p>
          </div>
          {stats && (
            <div className="summary-note">
              {fmt.format(stats.detections)} detections
              across {fmt.format(stats.photos)} photos
            </div>
          )}
        </div>

        {filtered.length > 0 ? (
          <div className="grid">
            {filtered.map((cluster) => (
              <DemoClusterCard key={cluster.id} cluster={cluster} categoryId={categoryId} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div>
              <h2>{search ? "No matching groups" : "No groups yet"}</h2>
              <p>{search ? "Try a different name or clear the search." : "No data available in this demo category."}</p>
            </div>
          </div>
        )}

        <footer className="kindling-footer">
          <span>By Kindling Signal</span>
          <p>Kindling builds useful software with character.</p>
        </footer>
      </main>
    </div>
  );
}

function DemoClusterCard({ cluster, categoryId }: { cluster: DemoCluster; categoryId: string }) {
  return (
    <Link href={`/demo/${categoryId}/${cluster.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="cluster-card">
        <div className="card-cover">
          {/* Show first photo as cover, avatar pip on top */}
          {cluster.photos.length > 1 ? (
            <>
              <img src={cluster.photos[1]} alt="" className="cover-photo" />
              <img src={cluster.avatar} alt="" className="cover-avatar-pip" />
            </>
          ) : (
            <img src={cluster.avatar} alt="" className="cover-photo" />
          )}
          <span className="cover-badge">
            {fmt.format(cluster.photoCount)} photos
          </span>
        </div>
        <div className="card-body">
          <div className="name-row">
            <span className="name">{cluster.label}</span>
          </div>
          <div className="card-meta">
            <span>{fmt.format(cluster.photoCount)} photos</span>
            <span>{fmt.format(cluster.photos.length)} samples</span>
          </div>
        </div>
        {/* Photo strip preview */}
        <div className="photo-strip">
          <div className="thumb-grid">
            {cluster.photos.slice(0, 6).map((photo, i) => (
              <div key={i} className="thumb">
                <img src={photo} alt="" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}
