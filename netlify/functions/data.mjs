import { getStore } from "@netlify/blobs";
import { requireUser } from "./_shared/auth-guard.mjs";

const STORE_NAME = "campus-cycle";
const DATA_KEY = "shared-data";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...jsonHeaders, ...(init.headers || {}) }
  });
}

export default async function handler(request) {
  const [user, unauthorized] = await requireUser(request);
  if (!user) return unauthorized;

  const store = getStore({ name: STORE_NAME, consistency: "strong" });

  if (request.method === "GET") {
    const data = await store.get(DATA_KEY, { type: "json", consistency: "strong" });
    return json({ data: data || null });
  }

  if (request.method === "POST") {
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    await store.setJSON(DATA_KEY, payload);
    return json({ ok: true, savedAt: new Date().toISOString() });
  }

  return json({ error: "Method not allowed" }, { status: 405 });
}
