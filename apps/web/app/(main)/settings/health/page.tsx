"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { KxErrorBanner, KxSkeletonRows } from "@/components/kx/states";
import type { HealthReport, HealthState } from "@/lib/health-check";
import { useUser } from "@/lib/use-user";
import styles from "./health.module.css";

const providers = [
  { name: "Vercel", statusPage: "https://www.vercel-status.com/" },
  { name: "Cloudflare", statusPage: "https://www.cloudflarestatus.com/" },
  { name: "NAS", activity: "/pipelines" },
] as const;

const statusLabels: Record<HealthState, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  unavailable: "Unavailable",
  unknown: "Unverified",
};

export default function HealthPage() {
  const { user, isLoading } = useUser();
  const { data, error, isFetching, isPending, refetch } = useQuery({
    queryKey: ["health-check", user?.userId],
    enabled: !!user,
    queryFn: async ({ signal }): Promise<HealthReport> => {
      const response = await fetch("/api/health-check", { signal, cache: "no-store" });
      if (response.status === 401) throw new Error("Sign in again to run the health checks.");
      if (!response.ok) throw new Error("The health report could not be loaded.");
      return response.json();
    },
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  return (
    <section aria-labelledby="health-heading">
      <div className={styles.heading}>
        <div>
          <h2 id="health-heading" className="kx-setting-title">Health check</h2>
          <p className={styles.subtitle}>Connectivity and availability for your Kindred services.</p>
        </div>
        <button className="kx-button" type="button" disabled={!user || isFetching} onClick={() => void refetch()}>
          {isFetching ? "Checking…" : "Refresh"}
        </button>
      </div>

      <p className={styles.timestamp} role="status">
        {isFetching ? "Checking services…" : data
          ? <>Last checked <time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleTimeString(undefined, {
            hour: "numeric", minute: "2-digit", second: "2-digit",
          })}</time></>
          : null}
      </p>
      {error && <KxErrorBanner detail={error.message} onRetry={() => void refetch()} />}

      {isLoading || (user && isPending) ? <KxSkeletonRows count={3} height={80} /> : !user
        ? <p><Link href="/login">Sign in</Link> to view service health.</p>
        : data && (
          <div className={styles.groups} aria-busy={isFetching}>
            {providers.map((provider) => (
              <section className={styles.group} key={provider.name} aria-label={provider.name}>
                <div className={styles.groupHeading}>
                  <h3>{provider.name}</h3>
                  {"statusPage" in provider
                    ? <a href={provider.statusPage} target="_blank" rel="noreferrer">Public status ↗</a>
                    : <Link href={provider.activity}>Indexing progress →</Link>}
                </div>
                <ul className={styles.checks}>
                  {data.checks.filter((check) => check.provider === provider.name).map((check) => (
                    <li key={check.id} className={styles.check}>
                      <div>
                        <strong>{check.label}</strong>
                        <p>{check.detail}</p>
                      </div>
                      <div className={styles.measurement}>
                        <span className={styles.badge} data-state={check.state}>{statusLabels[check.state]}</span>
                        {check.latencyMs !== null && <span className={styles.latency}>{check.latencyMs.toLocaleString()} ms</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
    </section>
  );
}
