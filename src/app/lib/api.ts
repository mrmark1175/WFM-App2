const rawApiBase = import.meta.env.VITE_API_BASE;

export const API_BASE = rawApiBase ? rawApiBase.replace(/\/+$/, "") : "";

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}
