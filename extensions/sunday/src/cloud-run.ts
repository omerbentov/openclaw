/**
 * Auto-detect the public Cloud Run service URL when running on GCP Cloud Run.
 *
 * Uses K_SERVICE env var + the GCE metadata server to resolve the full URL:
 *   https://<K_SERVICE>-<projectNumber>.<region>.run.app
 */

const METADATA_BASE = "http://metadata.google.internal/computeMetadata/v1";
const METADATA_HEADERS = { "Metadata-Flavor": "Google" };

async function fetchMetadata(path: string, timeoutMs = 3_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${METADATA_BASE}${path}`, {
      headers: METADATA_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`metadata ${path}: HTTP ${res.status}`);
    }
    return (await res.text()).trim();
  } finally {
    clearTimeout(timer);
  }
}

export function isCloudRun(): boolean {
  return Boolean(process.env.K_SERVICE);
}

/**
 * Resolve the public HTTPS URL for this Cloud Run service.
 * Returns null when not running on Cloud Run or if detection fails.
 */
export async function resolveCloudRunServiceUrl(): Promise<string | null> {
  const service = process.env.K_SERVICE?.trim();
  if (!service) return null;

  try {
    const [projectNumber, rawRegion] = await Promise.all([
      fetchMetadata("/project/numeric-project-id"),
      fetchMetadata("/instance/region"),
    ]);

    // rawRegion looks like "projects/123456/regions/us-central1"
    const region = rawRegion.split("/").pop();
    if (!projectNumber || !region) return null;

    return `https://${service}-${projectNumber}.${region}.run.app`;
  } catch {
    return null;
  }
}
