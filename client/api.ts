export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.detail || body?.error || "Recall could not complete this request. Please reload.", response.status, body?.code);
  return body as T;
}
