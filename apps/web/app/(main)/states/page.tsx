"use client";

import {
  KxEmptyLibrary,
  KxEmptyResults,
  KxErrorBanner,
  KxProgressRow,
  KxSkeletonGrid,
} from "@/components/kx/states";

/**
 * Not a product screen — the reference for the four states every grid and
 * panel needs, so a new screen has something to copy rather than something
 * to invent. Reached from the sync card in the sidebar.
 */
export default function StatesReferencePage() {
  return (
    <main className="kx-page" style={{ maxWidth: 1000 }}>
      <span className="kx-eyebrow">Reference</span>
      <h1 className="kx-title" style={{ fontSize: 40 }}>
        Empty, loading, broken.
      </h1>
      <p className="kx-lede">Not a product screen — the states every grid and panel needs.</p>

      <div className="kx-stateset" style={{ marginTop: 28 }}>
        <section>
          <span className="kx-eyebrow quiet">Loading · skeleton tiles, no spinner on grids</span>
          <KxSkeletonGrid count={6} tile={150} gap={4} />
        </section>

        <section className="kx-emptyrow">
          <KxEmptyLibrary eyebrow="Empty · nothing synced yet" />
          <KxEmptyResults eyebrow="Empty · search found nothing" onClear={() => undefined} />
        </section>

        <section>
          <span className="kx-eyebrow quiet">Error · server unreachable, sync failed</span>
          <KxErrorBanner
            detail="Last successful sync 3 hours ago · retrying in 30s"
            onRetry={() => undefined}
          />
          <KxProgressRow
            title="Analyzing 1,204 new photos"
            detail="Faces and scenes · about 6 minutes left"
            onPause={() => undefined}
          />
        </section>
      </div>
    </main>
  );
}
