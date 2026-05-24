/**
 * Fetch wrapper.
 * - Reads the JWT from localStorage (set by AuthProvider).
 * - Sends + parses JSON.
 * - Throws on non-2xx with a normalised ApiError.
 *
 * Two convenience helpers (`postForm`, `getBlob`) handle multipart uploads
 * and file downloads (CSV/PDF reports).
 */

const TOKEN_KEY = "relayToken";

export interface ApiErrorBody {
  error?: { code?: string; message?: string; issues?: Array<{ path: string; message: string }> };
}

export class ApiError extends Error {
  status: number;
  code?: string;
  issues?: Array<{ path: string; message: string }>;

  constructor(status: number, body: ApiErrorBody | string | undefined) {
    const msg =
      typeof body === "string" ? body : body?.error?.message ?? `Request failed (${status})`;
    super(msg);
    this.status = status;
    if (typeof body !== "string") {
      this.code = body?.error?.code;
      this.issues = body?.error?.issues;
    }
  }
}

export function getToken(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

function authHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function parseError(res: Response): Promise<never> {
  let body: ApiErrorBody | string | undefined;
  try { body = (await res.json()) as ApiErrorBody; } catch {
    try { body = await res.text(); } catch { body = undefined; }
  }
  throw new ApiError(res.status, body);
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { headers: { ...authHeader() }, signal });
  if (!res.ok) return parseError(res);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) return parseError(res);
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) return parseError(res);
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE", headers: { ...authHeader() } });
  if (!res.ok) return parseError(res);
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export async function postFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(path, { method: "POST", headers: { ...authHeader() }, body: form });
  if (!res.ok) return parseError(res);
  return (await res.json()) as T;
}

/** For CSV/PDF downloads. Triggers a browser download with the given filename. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(path, { headers: { ...authHeader() } });
  if (!res.ok) return parseError(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
