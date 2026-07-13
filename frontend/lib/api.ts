import { getFirebaseIdToken } from "@/lib/firebase/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

export async function apiFetch(path: string, init?: RequestInit) {
  const token = await getFirebaseIdToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers
  });
  return response;
}

export async function getHealth() {
  const response = await fetch(`${API_BASE_URL}/health/live`, {
    next: { revalidate: 60 }
  });
  if (!response.ok) throw new Error("API health check failed");
  return response.json();
}

/**
 * Submit one anonymous feedback entry (star rating + optional comment) to the
 * backend's public `/feedback` endpoint. No auth required — the widget also
 * runs for signed-out visitors — but we attach the Firebase token when present
 * so the request rides the same authenticated path as the rest of the app.
 */
export async function submitFeedback(
  rating: number,
  comment = "",
  context = ""
): Promise<void> {
  const raw = {
    page: typeof window !== "undefined" ? window.location.pathname : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    clientTime: new Date().toISOString()
  };
  const response = await apiFetch("/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating, comment, context, raw })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Backend ${response.status}: ${body || response.statusText}`);
  }
}
