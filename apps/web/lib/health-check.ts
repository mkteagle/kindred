import { isR2ThumbnailRedirect } from "./backend-url";

export type HealthState = "healthy" | "degraded" | "unavailable" | "unknown";
type Provider = "Vercel" | "Cloudflare" | "NAS";

type Result = { state: HealthState; detail: string };
export type HealthCheck = Result & {
  id: string;
  provider: Provider;
  label: string;
  latencyMs: number | null;
};
export type HealthReport = { checkedAt: string; checks: HealthCheck[] };

type Config = {
  catalog?: string;
  nas: string;
  vercelRuntime: boolean;
  sessionToken: string;
};
type RequestService = typeof fetch;
type Probe = (signal: AbortSignal) => Promise<Result>;

const healthy = (detail: string): Result => ({ state: "healthy", detail });
const unknown = (detail: string): Result => ({ state: "unknown", detail });
const unavailable = (detail: string): Result => ({ state: "unavailable", detail });

async function checkService(
  id: string, provider: Provider, label: string, probe: Probe,
  failure: HealthState = "unavailable",
): Promise<HealthCheck> {
  const start = performance.now();
  let result: Result;
  try {
    result = await probe(AbortSignal.timeout(5_000));
  } catch (error) {
    result = {
      state: failure,
      detail: error instanceof Error && error.name === "TimeoutError"
        ? "The check timed out after 5 seconds."
        : "The check could not reach the service.",
    };
  }
  return {
    id, provider, label, ...result,
    latencyMs: result.state === "unknown" ? null : Math.round(performance.now() - start),
  };
}

function request(requestService: RequestService, url: string, signal: AbortSignal, headers?: HeadersInit) {
  return requestService(url, { cache: "no-store", redirect: "error", signal, headers });
}

async function checkApi(requestService: RequestService, origin: string, signal: AbortSignal) {
  const response = await request(requestService, `${origin}/health`, signal);
  const throughCloudflare = response.headers.has("cf-ray");
  if (response.ok) {
    const data = await response.json();
    if (data?.status === "ok" && data?.db === "connected") {
      return { throughCloudflare, result: healthy("API responded and connected to PostgreSQL.") };
    }
  } else {
    void response.body?.cancel().catch(() => {});
  }
  return {
    throughCloudflare,
    result: unavailable(response.ok ? "The API returned an unexpected health response." : `The health endpoint returned HTTP ${response.status}.`),
  };
}

async function checkProvider(requestService: RequestService, url: string, signal: AbortSignal): Promise<Result> {
  const response = await request(requestService, url, signal, { "User-Agent": "Kindred Health (https://kindredphotos.app)" });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    return unknown("The provider’s public status feed could not be read.");
  }

  const indicator = (await response.json())?.status?.indicator;
  if (indicator === "none") return healthy("The provider reports normal operations.");
  if (indicator === "minor" || indicator === "maintenance") {
    return { state: "degraded", detail: "The provider reports an incident or maintenance." };
  }
  if (indicator === "major" || indicator === "critical") {
    return unavailable("The provider reports a major incident.");
  }
  return unknown("The provider’s public status response was unexpected.");
}

async function checkStorage(requestService: RequestService, origin: string, headers: HeadersInit, signal: AbortSignal): Promise<Result> {
  const response = await request(requestService, `${origin}/storage/status`, signal, headers);
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) return unknown("A valid NAS session is required.");
    return unavailable(`The storage check returned HTTP ${response.status}.`);
  }
  const data = await response.json();
  if (data?.configured === false) return unknown("The NAS reports no configured storage.");
  if (data?.available === true) return healthy("The NAS can read its library mount.");
  if (data?.available === false) return unavailable("The NAS cannot read its library mount.");
  return unknown("The NAS returned an unexpected storage response.");
}

async function checkThumbnail(requestService: RequestService, origin: string, headers: HeadersInit, signal: AbortSignal): Promise<Result> {
  let data;
  try {
    const response = await request(requestService, `${origin}/library/photos?limit=8&signed_thumbnails=true`, signal, headers);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return unknown("The catalog could not provide a thumbnail to test.");
    }
    data = await response.json();
  } catch {
    return unknown("The catalog could not provide a thumbnail to test.");
  }
  const url = Array.isArray(data?.photos)
    ? data.photos.map((photo: { thumbnail_url?: string } | null) => photo?.thumbnail_url)
      .find((value: unknown) => typeof value === "string" && isR2ThumbnailRedirect(value))
    : undefined;
  if (!url) return unknown("No signed R2 thumbnail was found in the latest library results.");

  const sample = await request(requestService, url, signal, { Range: "bytes=0-0" });
  void sample.body?.cancel().catch(() => {});
  return sample.ok && sample.headers.get("content-type")?.startsWith("image/")
    ? healthy("A signed thumbnail from the private R2 bucket responded.")
    : unavailable(`The signed thumbnail request returned HTTP ${sample.status} without a usable image.`);
}

export async function getHealthReport(config: Config, requestService: RequestService = fetch): Promise<HealthReport> {
  const { catalog, nas, vercelRuntime, sessionToken } = config;
  const headers = { "X-Session-Token": sessionToken };
  const nasSignal = AbortSignal.timeout(5_000);
  const nasHealth = checkApi(requestService, nas, nasSignal);
  const web: HealthCheck = {
    id: "web", provider: "Vercel", label: "Kindred web", latencyMs: null,
    ...vercelRuntime
      ? healthy("This report was served by the Vercel deployment.")
      : unknown("This report is running outside Vercel."),
  };

  const checks = await Promise.all([
    web,
    checkService("catalog", "Vercel", "Catalog API", async (signal) => catalog
      ? (await checkApi(requestService, catalog, signal)).result
      : unknown("A separate catalog API is not configured.")),
    checkService("vercel-platform", "Vercel", "Vercel platform status",
      (signal) => checkProvider(requestService, "https://www.vercel-status.com/api/v2/status.json", signal), "unknown"),
    checkService("tunnel", "Cloudflare", "Tunnel to NAS", async () => {
      try {
        const { throughCloudflare, result } = await nasHealth;
        if (!throughCloudflare) return unknown("The configured NAS route did not identify itself as Cloudflare.");
        return result.state === "healthy" ? healthy("The NAS answered through Cloudflare.")
          : { state: "degraded", detail: "Cloudflare answered, but the NAS health check failed." };
      } catch {
        return unknown("The NAS route did not respond, so the tunnel could not be verified.");
      }
    }),
    checkService("r2", "Cloudflare", "R2 thumbnail delivery",
      (signal) => checkThumbnail(requestService, catalog || nas, headers, signal)),
    checkService("cloudflare-platform", "Cloudflare", "Cloudflare platform status",
      (signal) => checkProvider(requestService, "https://www.cloudflarestatus.com/api/v2/status.json", signal), "unknown"),
    checkService("nas-api", "NAS", "NAS API", async () => (await nasHealth).result),
    checkService("nas-storage", "NAS", "Library storage",
      (signal) => checkStorage(requestService, nas, headers, signal)),
  ]);

  return { checkedAt: new Date().toISOString(), checks };
}
