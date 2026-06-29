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
