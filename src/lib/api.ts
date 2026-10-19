import { supabase } from "./supabase";
import { apiOverride } from "@backend";

async function llamar(path: string, body: unknown, token: string | undefined) {
  return fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Llama a una función serverless de /api enviando la sesión actual. */
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  if (apiOverride) return apiOverride(path, body);
  const { data } = await supabase.auth.getSession();
  let res = await llamar(path, body, data.session?.access_token);

  // Si la sesión venció (p. ej. la pestaña estuvo mucho tiempo abierta), se renueva y se reintenta una vez
  if (res.status === 401 && data.session) {
    const { data: nueva } = await supabase.auth.refreshSession();
    if (nueva.session) res = await llamar(path, body, nueva.session.access_token);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new Error("Tu sesión venció. Cerrá sesión y volvé a entrar.");
    throw new Error(json.error || `Error ${res.status}`);
  }
  return json as T;
}
