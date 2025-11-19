 
// src/rag.js
// chunk, embed openai(text-embedding-3-small), store(Qdrant)

import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import 'dotenv/config';
import crypto from "node:crypto";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const qdrant = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY });
const COLLECTION = "onedayprint_emails";

// ~ rough tokens ~= chars/3 for English; keep a margin// for chunking
const MAX_EMBED_CHARS = 24_000; // ~8k tokens budget

function toUuidFromString(s = "") {
  // Deterministic UUID-like string from SHA-1 (good enough for Qdrant's format check)
  const h = crypto.createHash("sha1").update(s).digest("hex"); // 40 hex chars
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

async function ensureCollection() {
  try {
    await qdrant.getCollection(COLLECTION);
  } catch {
    await qdrant.createCollection(COLLECTION, { vectors: { size: 1536, distance: "Cosine" } }); // 1536 for text-embedding-3-small
  }
}

//added for hit the token-limit on the embeddings call.
function truncateForEmbedding(s = "", limit = MAX_EMBED_CHARS) {
  if (!s) return "";
  if (s.length <= limit) return s;
  return s.slice(0, limit);
}

async function embed(text) {
  // 🚧 safety guard
  const safe = truncateForEmbedding(text);
  const r = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: safe,
    encoding_format: "float",
  });
  return r.data[0].embedding;
}

async function indexEmails(emailDocs /* [{id, subject, body, label}] */) {
  await ensureCollection();
  const points = [];
  for (const d of emailDocs) {
    const rawId = String(d.id); // may be "gmailId#chunk"
    const pointId = toUuidFromString(rawId); // ✅ valid UUID format
    const vec = await embed(`${d.subject}\n${d.body}`);
    points.push({ id: pointId, vector: vec, payload: d });
  }
  await qdrant.upsert(COLLECTION, { points });
}


async function retrieveSimilar(contextText, k = 10) { //retrieve top-10 relevant past replies
  await ensureCollection();
  const vec = await embed(contextText);
  const r = await qdrant.search(COLLECTION, { vector: vec, limit: k });
  return r.map(hit => hit.payload); // [{subject, body, label, ...}]
}
// Add this alongside retrieveSimilar (same collection, just filter to the website chunks and extract small snippets):
// rag.js
export async function retrieveSiteSnippets(query, {
  k = 8,
  score_threshold = 0.2,
} = {}) {
  await ensureCollection(); // your existing ensure
  const vec = await embed(query);

  // 1) vector search, but only for website chunks
  const r = await qdrant.search("onedayprint_emails", {
    vector: vec,
    limit: Math.max(k * 4, 20),
    with_payload: true,
    with_vector: false,
    score_threshold,
    params: { hnsw_ef: 128 }
  });

  // 2) turn payload.text into short, quotable snippets
  const needles = Array.from(new Set(
    String(query).toLowerCase().match(/[a-z0-9]{3,}/g) || []
  ));
  const toSnippet = (txt = "", max = 300) => {
    const low = txt.toLowerCase();
    let start = 0;
    for (const n of needles) {
      const i = low.indexOf(n);
      if (i >= 0) { start = Math.max(0, i - 80); break; }
    }
    return txt.slice(start, start + max).replace(/\s+/g, " ").trim();
  };

  return r
    .filter(h => h?.payload?.text)
    .slice(0, k)
    .map(h => ({
      url: h.payload.url,
      title: h.payload.title,
      snippet: toSnippet(h.payload.text),
    }));
}

export { embed, indexEmails, retrieveSimilar };
