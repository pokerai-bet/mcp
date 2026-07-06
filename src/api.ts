// Thin fetch client for the Pokerai API. Auth is the caller's own API key (their quota),
// so this server has no abuse surface of its own.

const BASE = process.env.POKERAI_API_BASE ?? "https://pokerai.bet";

function apiKey(): string {
  const k = process.env.POKERAI_API_KEY;
  if (!k) {
    throw new Error("POKERAI_API_KEY is not set. Get a free key at https://pokerai.bet/login");
  }
  return k;
}

async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      authorization: `Bearer ${apiKey()}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let data: unknown = raw;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    /* non-JSON error body — keep raw text */
  }
  if (!res.ok) {
    const d = data as Record<string, unknown> | string;
    const msg =
      typeof d === "object" && d && "message" in d ? String((d as Record<string, unknown>).message)
      : typeof d === "object" && d && "error" in d ? String((d as Record<string, unknown>).error)
      : raw.slice(0, 300);
    throw new Error(`Pokerai API ${res.status}: ${msg}`);
  }
  return data;
}

export const apiGet = (path: string): Promise<unknown> => request("GET", path);
export const apiPost = (path: string, body: unknown): Promise<unknown> => request("POST", path, body);
