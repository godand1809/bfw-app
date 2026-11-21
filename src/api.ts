/**
 * src/api.ts -- Typed API client for BFT QR Pay.
 *
 * VERSION: 1.0.0 (initial release)
 *
 * Holds the session Bearer token strictly in memory (never localStorage or
 * sessionStorage) and also includes HttpOnly cookies via credentials:'include'
 * with an explicit X-Requested-With header.
 */

let memorySessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  memorySessionToken = token;
}

export function clearSessionToken(): void {
  memorySessionToken = null;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'BFT-QR-Pay',
    ...(opts.headers as Record<string, string> | undefined),
  };

  if (memorySessionToken) {
    headers.Authorization = `Bearer ${memorySessionToken}`;
  }

  const res = await fetch(path, {
    credentials: 'include',
    ...opts,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data?.detail === 'string'
        ? data.detail
        : res.statusText || 'Request failed';
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export function formatMoney(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
