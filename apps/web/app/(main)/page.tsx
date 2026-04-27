"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { KindlingFooter } from "@/components/kindling-footer";
import type { User, Stats } from "@/types";
import { BACKEND, CATEGORIES, HERO_PHOTOS, fmt } from "@/lib/constants";

const API = "/api";

/* ── Landing page data ──────────────────────────────────────────────── */

const LANDING_FEATURES = [
  {
    title: "People first",
    desc: "Face recognition groups photos by the people who matter, so you browse by name instead of date.",
    icon: "M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2 M12.5 7.5a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z M20 8v6 M23 11h-6",
  },
  {
    title: "Search the way you remember",
    desc: "Describe a scene, a color, or a feeling. CLIP-powered visual search finds what folders never could.",
    icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  },
  {
    title: "Your server, your photos",
    desc: "Self-hosted, private, and open source. Your family memory stays in your household, not on someone else's platform.",
    icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Connect your Flickr",
    desc: "Sign in with your Flickr account and Kindred imports your entire photo library.",
  },
  {
    num: "02",
    title: "AI organizes everything",
    desc: "Faces, objects, places, and scenes are detected and grouped automatically.",
  },
  {
    num: "03",
    title: "Your whole family can browse",
    desc: "Invite household members so everyone can search, browse, and rediscover together.",
  },
];

const SHOWCASE_PHOTOS = [
  "https://images.pexels.com/photos/34955571/pexels-photo-34955571.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/34955549/pexels-photo-34955549.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/34955541/pexels-photo-34955541.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/34955536/pexels-photo-34955536.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/34955530/pexels-photo-34955530.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/34955527/pexels-photo-34955527.jpeg?auto=compress&cs=tinysrgb&w=600",
];

/* ── Library dashboard data (same as before) ────────────────────────── */

const FEATURES = [
  { title: "People First", desc: "Group the people in your library so the names that matter are always easier to find again.", icon: "M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2 M12.5 7.5a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z M20 8v6 M23 11h-6" },
  { title: "Search by Memory", desc: "Look for a beach day, a birthday table, or a mountain evening and surface the right photos without digging.", icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
  { title: "Moments & Things", desc: "Browse more than faces, with objects, colors, and scenes that help the library feel actually navigable.", icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { title: "Time & Place", desc: "Move through the library by date, map, and place so trips and everyday stretches come back into view.", icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" },
  { title: "Less Clutter", desc: "Pull near-duplicates together and use color or category browsing to cut through the pile faster.", icon: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343" },
  { title: "Private by Default", desc: "Your library stays yours, with access controlled through your account instead of handing family memory to another rented platform.", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" },
];

const PILLARS = [
  {
    label: "For households",
    title: "Easy enough to share",
    body: "Kindred should make sense to the least technical person in the house, not just the person who set it up.",
  },
  {
    label: "For memory",
    title: "Built around belonging",
    body: "The library starts with people, then stretches into places, colors, objects, and the moments that make family photos worth keeping.",
  },
  {
    label: "For real use",
    title: "Private without the sprawl",
    body: "Keep control of the photo library while still getting the kind of browsing and search that makes old photos feel reachable again.",
  },
];

const BROWSE_PATHS = [
  "People",
  "Places",
  "Moments",
  "Colors",
  "Timeline",
];

/* ── Component ──────────────────────────────────────────────────────── */

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/auth/me`)
      .then((r) => r.json())
      .then((d: User) => { if (d.loggedIn) setUser(d); setAuthLoading(false); })
      .catch(() => setAuthLoading(false));
  }, []);

  const { data: stats } = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: () => fetch(`${BACKEND}/stats`).then((r) => r.json()),
    enabled: !!user,
  });

  if (authLoading) {
    return (
      <main className="page" style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
        <span className="spinner" />
      </main>
    );
  }

  /* Logged in: show library dashboard */
  if (user) {
    return <LibraryDashboard user={user} stats={stats} />;
  }

  /* Not logged in: show landing page */
  return <LandingPage />;
}

/* ── Landing Page ───────────────────────────────────────────────────── */

function LandingPage() {
  return (
    <main className="landing">
      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-hero-brand">
            <img src="/kindred-icon.svg" alt="" className="landing-hero-icon" />
            <img src="/kindred-wordmark.svg" alt="Kindred Photos" className="landing-hero-wordmark" />
          </div>

          <h1 className="landing-h1">A calmer home for family photos.</h1>

          <p className="landing-subtitle">
            Backed up to your Flickr, organized by AI, owned by your household.
          </p>

          <div className="landing-ctas">
            <Link href="/demo" className="button primary" style={{ textDecoration: "none" }}>
              Try the demo
            </Link>
            <Link href="/login" className="button ghost" style={{ textDecoration: "none" }}>
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="landing-section">
        <div className="landing-section-head">
          <span className="landing-eyebrow">What makes it different</span>
          <h2>Built for households, not power users.</h2>
        </div>
        <div className="landing-features">
          {LANDING_FEATURES.map((f) => (
            <div key={f.title} className="landing-feature-card">
              <div className="landing-feature-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {f.icon.split(" M").map((seg, i) => (
                    <path key={i} d={i === 0 ? seg : `M${seg}`} />
                  ))}
                </svg>
              </div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="landing-section landing-steps-section">
        <div className="landing-section-head">
          <span className="landing-eyebrow">How it works</span>
          <h2>Three steps to a family library.</h2>
        </div>
        <div className="landing-steps">
          {STEPS.map((s) => (
            <div key={s.num} className="landing-step">
              <span className="landing-step-num">{s.num}</span>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Photo showcase */}
      <section className="landing-section">
        <div className="landing-section-head">
          <span className="landing-eyebrow">See it in action</span>
          <h2>Your library, finally browsable.</h2>
        </div>
        <div className="landing-showcase-grid">
          {SHOWCASE_PHOTOS.map((src, i) => (
            <img key={src} src={src} alt={`Family photo example ${i + 1}`} className="landing-showcase-photo" />
          ))}
        </div>
      </section>

      {/* Open source callout */}
      <section className="landing-section landing-oss">
        <div className="landing-oss-inner">
          <span className="landing-eyebrow">Open source</span>
          <h2>Open source under AGPL-3.0</h2>
          <p>
            Kindred is built in the open. Self-host it, contribute to it, or just browse the code.
          </p>
          <div className="landing-oss-links">
            <a href="https://github.com/mkteagle/kindred" target="_blank" rel="noopener noreferrer" className="button dark" style={{ textDecoration: "none" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              View on GitHub
            </a>
            <span className="landing-oss-note">Built by Kindling Signal</span>
          </div>
        </div>
      </section>

      <KindlingFooter />
    </main>
  );
}

/* ── Library Dashboard (logged-in view) ─────────────────────────────── */

function LibraryDashboard({ user, stats }: { user: User; stats: Stats | undefined }) {
  const totalDetections = CATEGORIES.reduce(
    (sum, item) => sum + Number(stats?.[item.id]?.detections || 0), 0
  );

  return (
    <main className="page">
      {/* Hero */}
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-brandline">
            <img
              src="/kindred-wordmark.svg"
              alt="Kindred"
              className="hero-wordmark"
            />
          </div>
          <div className="eyebrow">Private family photo library</div>
          <h1>A calmer home for family photos.</h1>
          <p>
            Kindred turns the pile into something a household can actually use:
            people first, then places, objects, and the small moments worth
            finding again.
          </p>
          <div className="hero-actions">
            <Link href="/people" className="button primary" style={{ textDecoration: "none" }}>
              Go to library
            </Link>
            <span className="hero-note">Built for the whole household, not just the organized one.</span>
          </div>
          <div className="hero-paths" aria-label="Browse library paths">
            {BROWSE_PATHS.map((item) => (
              <span key={item} className="hero-path-chip">{item}</span>
            ))}
          </div>
          <div className="hero-mini-grid">
            {PILLARS.map((pillar) => (
              <article key={pillar.title} className="hero-mini-card">
                <span>{pillar.label}</span>
                <strong>{pillar.title}</strong>
                <p>{pillar.body}</p>
              </article>
            ))}
          </div>
        </div>

        <aside className="hero-panel" aria-label="Photo library preview">
          <div className="memory-wall">
            {HERO_PHOTOS.map((photo, index) => (
              <img key={photo} src={photo} alt="" className={`memory memory-${index + 1}`} />
            ))}
            <div className="memory-label">
              <span>Kindred index</span>
              <strong>{fmt.format(totalDetections)} found items</strong>
            </div>
          </div>
          <div className="panel-title">Library signals</div>
          <div className="metric-grid">
            {CATEGORIES.map((category) => (
              <Link href={`/${category.id}`} key={category.id} className="metric" style={{ textDecoration: "none", color: "inherit" }}>
                <strong>{fmt.format(stats?.[category.id]?.detections || 0)}</strong>
                <span>{category.label}</span>
              </Link>
            ))}
          </div>
          <div className="hero-panel-note">
            People first, with places, objects, colors, and time ready to make the whole library easier to move through.
          </div>
        </aside>
      </section>

      <section className="home-band">
        <div className="content-head home-band-head">
          <div>
            <h2>Why it feels different</h2>
            <p>Less like a utility, more like a household memory library with real ways in.</p>
          </div>
        </div>
        <div className="pillars-grid">
          {PILLARS.map((pillar) => (
            <article key={pillar.title} className="pillar-card">
              <span>{pillar.label}</span>
              <h3>{pillar.title}</h3>
              <p>{pillar.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="home-section">
        <div className="content-head" style={{ marginBottom: 24 }}>
          <div>
            <h2>Ways into the library</h2>
            <p>Useful browse paths shaped around memory instead of tool jargon.</p>
          </div>
        </div>
        <div className="features-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature-card">
              <svg className="feature-icon" width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {f.icon.split(" M").map((seg, i) => (
                  <path key={i} d={i === 0 ? seg : `M${seg}`} />
                ))}
              </svg>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Browse library (only for logged in users) */}
      {totalDetections > 0 && (
        <section className="home-section">
          <div className="content-head" style={{ marginBottom: 16 }}>
            <div>
              <h2>Browse your library</h2>
              <p>Select a category to view and manage your grouped photos.</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            {CATEGORIES.map((cat) => (
              <Link href={`/${cat.id}`} key={cat.id} className="button dark" style={{ textDecoration: "none", flex: "1 1 auto", textAlign: "center", minWidth: 120 }}>
                {cat.label} ({fmt.format(stats?.[cat.id]?.detections || 0)})
              </Link>
            ))}
          </div>
        </section>
      )}

      <KindlingFooter />
    </main>
  );
}
