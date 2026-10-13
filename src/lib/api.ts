import { supabase } from "./supabase";
import { apiOverride } from "@backend";

/** Llama a una función serverless de /api enviando la sesión actual. */
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  if (apiOverride) return apiOverride(path, body);
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
  return json as T;
}
