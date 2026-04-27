"use client";

import Link from "next/link";
import { DEMO_CATEGORIES, DEMO_STATS, DEMO_TIMELINE } from "./demo-data";

const fmt = new Intl.NumberFormat();

export default function DemoLibraryPage() {
  const totalPhotos = DEMO_STATS.people.detections + DEMO_STATS.pets.detections + DEMO_STATS.vehicles.detections;
  const totalGroups = DEMO_STATS.people.groups + DEMO_STATS.pets.groups + DEMO_STATS.vehicles.groups;

  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head">
          <div>
            <h2>Your Library</h2>
            <p>
              Kindred has organized your photos into {fmt.format(totalGroups)} groups
              across {DEMO_CATEGORIES.length} categories.
            </p>
          </div>
          <div className="summary-note">
            {fmt.format(totalPhotos)} detections across your library
          </div>
        </div>

        {/* Category overview cards */}
        {DEMO_CATEGORIES.map((cat) => {
          const statsKey = cat.id as keyof typeof DEMO_STATS;
          const stats = DEMO_STATS[statsKey];
          return (
            <section key={cat.id} style={{ marginBottom: 40 }}>
              <div className="content-head" style={{ marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontFamily: "var(--display)", fontSize: 28 }}>
                    {cat.label}
                  </h3>
                  <p style={{ margin: "4px 0 0", color: "var(--mist)", fontSize: 13 }}>
                    {fmt.format(stats.groups)} groups &middot; {fmt.format(stats.detections)} detections
                  </p>
                </div>
                <Link
                  href={`/demo/${cat.id}`}
                  style={{
                    color: "var(--pine)",
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  View all &rarr;
                </Link>
              </div>

              <div className="grid">
                {cat.clusters.slice(0, 4).map((cluster) => (
                  <Link
                    key={cluster.id}
                    href={`/demo/${cat.id}/${cluster.id}`}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div className="cluster-card">
                      <div className="card-cover">
                        <img src={cluster.avatar} alt="" className="cover-photo" />
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
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        {/* Recent photos grid */}
        <section style={{ marginTop: 32 }}>
          <div className="content-head" style={{ marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontFamily: "var(--display)", fontSize: 28 }}>
                Recent Photos
              </h3>
              <p style={{ margin: "4px 0 0", color: "var(--mist)", fontSize: 13 }}>
                Latest additions to your library
              </p>
            </div>
          </div>
          <div className="clip-results-grid">
            {DEMO_TIMELINE.flatMap((m) => m.photos).slice(0, 12).map((tp, i) => (
              <div key={i} className="clip-result-card">
                <img src={tp.thumb_url} alt="" />
                <div className="clip-result-info">
                  <span className="clip-result-title">{tp.photo_title}</span>
                  <span className="clip-result-score">{tp.date_taken}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA to sign up */}
        <section style={{
          marginTop: 48,
          textAlign: "center",
          padding: "48px 24px",
          borderRadius: 12,
          border: "1px solid rgba(74, 40, 26, .1)",
          background: "linear-gradient(180deg, rgba(255, 253, 248, .84), rgba(247, 235, 212, .52))",
          boxShadow: "0 18px 36px rgba(109, 60, 36, .08)",
        }}>
          <h2 style={{ margin: "0 0 10px", fontFamily: "var(--display)", fontSize: 32 }}>
            Ready to organize your own photos?
          </h2>
          <p style={{ margin: "0 auto 24px", maxWidth: 480, color: "#6f5648", fontSize: 16 }}>
            Connect your library and let Kindred automatically recognize people, pets, and vehicles.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/login" className="button primary" style={{ textDecoration: "none" }}>
              Sign in to get started
            </Link>
            <Link href="/" className="button ghost" style={{ textDecoration: "none" }}>
              Back to home
            </Link>
          </div>
        </section>

        <footer className="kindling-footer">
          <span>By Kindling Signal</span>
          <p>Kindling builds useful software with character.</p>
        </footer>
      </main>
    </div>
  );
}
