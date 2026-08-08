import { getStore } from "@netlify/blobs";

const STORE_NAME = "campus-cycle-images";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { contentType: match[1], body: match[2] };
}

export default async function handler(request) {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const url = new URL(request.url);

  if (request.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "Missing image id" }, { status: 400 });
    const record = await store.get(id, { type: "json", consistency: "strong" });
    if (!record) return json({ error: "Image not found" }, { status: 404 });
    const parsed = parseDataUrl(record.dataUrl);
    if (!parsed) return json({ error: "Invalid image data" }, { status: 500 });
    const bytes = Uint8Array.from(Buffer.from(parsed.body, "base64"));
    return new Response(bytes, {
      headers: {
        "content-type": parsed.contentType,
        "cache-control": "public, max-age=31536000, immutable"
      }
    });
  }

  if (request.method === "POST") {
    const payload = await request.json().catch(() => null);
    const parsed = parseDataUrl(payload && payload.image);
    if (!payload || !payload.id || !parsed) {
      return json({ error: "Invalid image payload" }, { status: 400 });
    }
    await store.setJSON(payload.id, { dataUrl: payload.image, savedAt: new Date().toISOString() });
    return json({ ok: true, url: `/.netlify/functions/image?id=${encodeURIComponent(payload.id)}` });
  }

  return json({ error: "Method not allowed" }, { status: 405 });
}
