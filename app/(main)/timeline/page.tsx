"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Spinner } from "@/components/ui";
import type { TimelineResponse, TimelineMonth } from "@/types";
import { BACKEND, fmt } from "@/lib/constants";

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function MonthSection({ month }: { month: TimelineMonth }) {
  const [expanded, setExpanded] = useState(false);
  const preview = month.photos.slice(0, 12);
  const remaining = month.photos.length - preview.length;
  const visible = expanded ? month.photos : preview;

  return (
    <section className="timeline-month">
      <div className="timeline-month-header">
        <div>
          <h3 className="timeline-month-label">{formatMonth(month.month)}</h3>
          <span className="timeline-month-count">
            {fmt.format(month.count)} photo{month.count !== 1 ? "s" : ""}
          </span>
        </div>
        {remaining > 0 && (
          <Button small variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show less" : `Show all ${fmt.format(month.count)}`}
          </Button>
        )}
      </div>
      <div className="clip-results-grid">
        {visible.map((photo) => (
          <a
            key={photo.photo_id}
            href={photo.flickr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="clip-result-card"
          >
            <img src={photo.thumb_url} alt={photo.photo_title || ""} />
            <div className="clip-result-info">
              <span className="clip-result-title">
                {photo.photo_title || "Untitled"}
              </span>
              <span className="clip-result-score">
                {photo.date_taken
                  ? new Date(photo.date_taken).toLocaleDateString()
                  : ""}
              </span>
            </div>
          </a>
        ))}
      </div>
      {!expanded && remaining > 0 && (
        <p className="summary-note" style={{ textAlign: "left", marginTop: 10 }}>
          +{fmt.format(remaining)} more photo{remaining !== 1 ? "s" : ""}
        </p>
      )}
    </section>
  );
}

export default function TimelinePage() {
  const { data, isLoading } = useQuery<TimelineResponse>({
    queryKey: ["timeline"],
    queryFn: () => fetch(`${BACKEND}/timeline`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000, // 5 min — data doesn't change often
  });

  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const months = data?.months || [];

  // Extract unique years sorted descending
  const years = useMemo(() => {
    const set = new Set<string>();
    months.forEach((m) => set.add(m.month.split("-")[0]));
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [months]);

  // Extract months for selected year
  const monthsInYear = useMemo(() => {
    if (!selectedYear) return [];
    const set = new Set<string>();
    months.forEach((m) => {
      if (m.month.startsWith(selectedYear)) {
        set.add(m.month.split("-")[1]);
      }
    });
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [months, selectedYear]);

  // Filter months based on selection
  const filtered = useMemo(() => {
    if (selectedMonth && selectedYear) {
      return months.filter((m) => m.month === `${selectedYear}-${selectedMonth}`);
    }
    if (selectedYear) {
      return months.filter((m) => m.month.startsWith(selectedYear));
    }
    return months;
  }, [months, selectedYear, selectedMonth]);

  const totalPhotos = filtered.reduce((sum, m) => sum + m.count, 0);

  const monthName = (num: string) => {
    const d = new Date(2000, Number(num) - 1);
    return d.toLocaleDateString("en-US", { month: "short" });
  };

  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head" style={{ marginBottom: 16 }}>
          <div>
            <h2>Timeline</h2>
            <p>Browse your photos organized by date.</p>
          </div>
          {totalPhotos > 0 && (
            <div className="summary-note">
              {fmt.format(filtered.length)} month{filtered.length !== 1 ? "s" : ""}, {fmt.format(totalPhotos)} photos
            </div>
          )}
        </div>

        {/* Filter controls */}
        {!isLoading && months.length > 0 && (
          <div className="tl-filters">
            {/* Year pills */}
            <div className="tl-filter-row">
              <span className="tl-filter-label">Year</span>
              <div className="tl-pills">
                <button
                  className={`tl-pill ${!selectedYear ? "is-active" : ""}`}
                  onClick={() => { setSelectedYear(null); setSelectedMonth(null); }}
                >
                  All
                </button>
                {years.map((y) => {
                  const count = months.filter((m) => m.month.startsWith(y)).reduce((s, m) => s + m.count, 0);
                  return (
                    <button
                      key={y}
                      className={`tl-pill ${selectedYear === y ? "is-active" : ""}`}
                      onClick={() => { setSelectedYear(y); setSelectedMonth(null); }}
                    >
                      {y}
                      <span className="tl-pill-count">{fmt.format(count)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Month pills (visible when year is selected) */}
            {selectedYear && monthsInYear.length > 1 && (
              <div className="tl-filter-row">
                <span className="tl-filter-label">Month</span>
                <div className="tl-pills">
                  <button
                    className={`tl-pill ${!selectedMonth ? "is-active" : ""}`}
                    onClick={() => setSelectedMonth(null)}
                  >
                    All {selectedYear}
                  </button>
                  {monthsInYear.map((m) => {
                    const full = `${selectedYear}-${m}`;
                    const entry = months.find((e) => e.month === full);
                    return (
                      <button
                        key={m}
                        className={`tl-pill ${selectedMonth === m ? "is-active" : ""}`}
                        onClick={() => setSelectedMonth(m)}
                      >
                        {monthName(m)}
                        {entry && <span className="tl-pill-count">{fmt.format(entry.count)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Active filter breadcrumb */}
            {selectedYear && (
              <div className="tl-breadcrumb">
                <button className="tl-crumb" onClick={() => { setSelectedYear(null); setSelectedMonth(null); }}>
                  All years
                </button>
                <span className="tl-crumb-sep">/</span>
                <button className="tl-crumb" onClick={() => setSelectedMonth(null)}>
                  {selectedYear}
                </button>
                {selectedMonth && (
                  <>
                    <span className="tl-crumb-sep">/</span>
                    <span className="tl-crumb is-current">{monthName(selectedMonth)} {selectedYear}</span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {isLoading && (
          <div className="empty-state"><Spinner /></div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="empty-state">
            <div>
              <h2>No photos found</h2>
              <p>
                {months.length === 0
                  ? "No photos with date information. Run a metadata backfill first."
                  : "No photos match the selected filter."}
              </p>
            </div>
          </div>
        )}

        {!isLoading && filtered.map((month) => (
          <MonthSection key={month.month} month={month} />
        ))}

        <footer className="kindling-footer">
          <span>By Kindling Signal</span>
          <p>
            Kindling builds useful software with character: warm enough for
            real homes, sharp enough to hold up in real use.
          </p>
        </footer>
      </main>
    </div>
  );
}
