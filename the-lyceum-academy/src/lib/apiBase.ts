const LOCAL_API_BASE = 'http://localhost:8000';
const PRODUCTION_API_BASE = 'https://lyceum-academy-production.up.railway.app';

function normalizeBase(value: string): string {
  return value.replace(/\/$/, '');
}

/**
 * Resolve the backend base URL for browser clients.
 *
 * Production has historically used both VITE_API_URL and VITE_API_BASE in
 * different files/docs, so we accept either to avoid a silent fallback to
 * localhost when one of them is missing.
 */
export function getApiBaseUrl(): string {
  const env = (import.meta as any).env || {};
  const viteBase =
    (env.VITE_API_URL as string | undefined) ||
    (env.VITE_API_BASE as string | undefined);

  if (viteBase?.trim()) {
    return normalizeBase(viteBase.trim());
  }

  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return LOCAL_API_BASE;
    }

    // Railway deploy previews and production backend hosts both live under
    // railway.app, so if the current page is already on that host we can use
    // it directly instead of depending on a hardcoded slug.
    if (hostname.includes('railway.app')) {
      return normalizeBase(origin);
    }
  }

  return PRODUCTION_API_BASE;
}
