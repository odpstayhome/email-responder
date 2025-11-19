// index_homepage_to_qdrant.mjs
// run this file if wanna index and embed the website info (node .\src\index_homepage_to_qdrant.mjs)
//not related to main process
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "url";
import "dotenv/config"; // reads .env into process.env

// --- clients ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

// --- helpers ---
function toUuidFromString(s = "") {
  const h = crypto.createHash("sha1").update(s).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

async function ensureCollection(name, size = 1536, distance = "Cosine") {
  try {
    await qdrant.getCollection(name);
  } catch {
    await qdrant.createCollection(name, { vectors: { size, distance } });
  }
}

async function embed(text) {
  const safe = text.length > 24000 ? text.slice(0, 24000) : text;
  const r = await openai.embeddings.create({
    model: "text-embedding-3-small", // 1536 dims
    input: safe,
    encoding_format: "float",
  });
  return r.data[0].embedding;
}


// --- newline-preserving cleaner + chunker ---
function htmlToCleanText(html = "") {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const blocks = ["p","br","li","ul","ol","h1","h2","h3","h4","h5","h6","section","article","div","tr","td","th"];
  for (const tag of blocks) {
    const open = new RegExp(`<${tag}[^>]*>`, "gi");
    const close = new RegExp(`</${tag}>`, "gi");
    s = s.replace(open, "\n").replace(close, "\n");
  }

  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#038;|&amp;/g, "&")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkByLines(text, maxChars = 900) {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const out = [];
  let buf = "";
  for (const line of lines) {
    if ((buf + " " + line).length > maxChars) { out.push(buf.trim()); buf = line; }
    else { buf += (buf ? " " : "") + line; }
  }
  if (buf) out.push(buf.trim());
  return out;
}

async function fetchPlainText(url) {
  const res = await fetch(url, { headers: { "user-agent": "ODPIndexer/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  const title = (html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] ?? "").trim();
  const text = htmlToCleanText(html);        // <— changed line
  return { title, text };
}

function normalizeUrl(s) {
  if (!s) return null;
  try {
    // fix common accidental spaces
    const cleaned = s.replace(/\s+/g, "");
    const u = new URL(cleaned);
    return u.href;
  } catch {
    return null;
  }
}

// small concurrency helper (no deps)
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      try {
        results[idx] = { ok: true, value: await fn(items[idx], idx) };
      } catch (e) {
        results[idx] = { ok: false, error: e };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function indexOneUrl(url, collection) {
  const { title, text } = await fetchPlainText(url);
  const docBase = { id: `web:${url}`, doc_id: `site:${url}`, doc_type: "webpage", url, title };
  const chunks = chunkByLines(`${title}\n\n${text}`, 900);
  const wrapped = await mapLimit(chunks, 3, async (chunk, i) => ({
    id: toUuidFromString(`${docBase.id}#${i}`),
    vector: await embed(chunk),
    payload: { ...docBase, section: i, text: chunk }
  }));

  // unwrap only successful values; log failures
  const points = wrapped.filter(r => r?.ok && r.value).map(r => r.value);
  const errs   = wrapped.filter(r => !r?.ok).map(r => r?.error);
  if (errs.length) console.warn(`[${url}] ${errs.length} chunk(s) failed to embed`);
  if (!points.length) throw new Error("No valid points to upsert");

  try {
    await qdrant.upsert(collection, { points, wait: true });
  } catch (err) {
    console.error("Qdrant error:", JSON.stringify(err?.response?.data || err, null, 2));
    throw err;
  }
  return { url, title, chunks: points.length };
}


async function indexUrls(urls, { collection = "onedayprint_emails", concurrency = 2 } = {}) {
  await ensureCollection(collection, 1536, "Cosine");

  const results = await mapLimit(urls, concurrency, async (u) => {
    const href = normalizeUrl(u);
    if (!href) throw new Error(`Invalid URL: ${u}`);
    const out = await indexOneUrl(href, collection);
    console.log(`✓ Indexed ${href}`);
    return out;
  });

  const ok = results.filter(r => r?.ok).length;
  const fail = results.length - ok;
  if (fail) {
    console.log(`\nCompleted with ${ok} success, ${fail} failed:`);
    results.forEach((r, i) => {
      if (!r?.ok) console.log(`  - [${i}] ${urls[i]} → ${r?.error?.message || r?.error}`);
    });
  } else {
    console.log(`\nAll ${ok} pages indexed into ${collection}.`);
  }
  return results;
}

async function testSearch(query = "PVC vs Synthetic waterproof", collection = "onedayprint_emails") {
  const vec = await embed(query);
  const hits = await qdrant.search(collection, {
    vector: vec,
    limit: 5,
    with_payload: true,
    with_vector: false,
  });
  console.log(
    hits.map((h) => ({
      score: h.score,
      url: h.payload?.url,
      title: h.payload?.title,
    }))
  );
}

// --- CLI ---
function parseArgs(argv) {
  const out = { urls: [], file: null, collection: "onedayprint_emails", concurrency: 2 };
  for (const a of argv) {
    if (a.startsWith("--file=")) out.file = a.split("=")[1];
    else if (a.startsWith("--collection=")) out.collection = a.split("=")[1];
    else if (a.startsWith("--concurrency=")) out.concurrency = Math.max(1, Number(a.split("=")[1]) || 2);
    else out.urls.push(a);
  }
  return out;
}

async function main() {
  const { urls: argvUrls, file, collection, concurrency } = parseArgs(process.argv.slice(2));

  let urls = [...argvUrls];
  if (file) {
    const txt = await fs.readFile(file, "utf8");
    const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    urls.push(...lines);
  }
  // default if none passed
  if (urls.length === 0) {
    urls = ["https://onedayprint.com.sg/", "https://onedayprint.com.sg/sticker-shapes/", "https://onedayprint.com.sg/sticker-shapes/round-oval-shape-stickers/",
        "https://onedayprint.com.sg/sticker-shapes/square-rectangle-shape-stickers/","https://onedayprint.com.sg/sticker-shapes/rounded-square-rectangle-shape-stickers/","https://onedayprint.com.sg/sticker-shapes/uncut-sticker-sheets/"
        ,"https://onedayprint.com.sg/sticker-shapes/ez-link-stickers/","https://onedayprint.com.sg/sticker-shapes/custom-shape-stickers/", "https://onedayprint.com.sg/sticker-shapes/custom-sticker-sets/"
        ,"https://onedayprint.com.sg/name-card-types/", "https://onedayprint.com.sg/name-card-printing-in-singapore/", "https://onedayprint.com.sg/name-card-printing-in-singapore/name-card-pricing/",
        "https://onedayprint.com.sg/artwork-specifications-namecards/","https://onedayprint.com.sg/name-card-printing-in-singapore/name-card-templates/", "https://onedayprint.com.sg/name-card-printing-in-singapore/round-corner-name-card/",
        "https://onedayprint.com.sg/synthetic-name-cards/", "https://onedayprint.com.sg/all-paper-materials/", "https://onedayprint.com.sg/all-sizes-for-digital-print/",
        "https://onedayprint.com.sg/art-cards-300-350gsm/", "https://onedayprint.com.sg/majestic-metallic-series-paper/", "https://onedayprint.com.sg/artwork-specifications-digital-prints/", "https://onedayprint.com.sg/artwork-specifications/",
        "https://onedayprint.com.sg/specialty-paper-price-list/", "https://onedayprint.com.sg/art-cards-300-350gsm/300gsm-super-thick-paper-pricing/", "https://onedayprint.com.sg/smooth-poster-flyer-paper-170gsm/170gsm-thick-paper-printing-prices/"
        , "https://onedayprint.com.sg/smooth-poster-flyer-paper-170gsm/", "https://onedayprint.com.sg/synthetic-paper/" , "https://onedayprint.com.sg/synthetic-paper/synthetic-paper-printing-prices/", 
        "https://onedayprint.com.sg/a4-3-fold-brochure/", "https://onedayprint.com.sg/a4-3-fold-brochure/a4-triple-fold-flyer-printing-pricing/", "https://onedayprint.com.sg/artwork-specifications-digital-prints/a4-a4-folded/",
        "https://onedayprint.com.sg/artwork-specifications-digital-prints/a5-a5-folded/#artspecsA5", "https://onedayprint.com.sg/artwork-specifications-digital-prints/a6-a7/#artspecsA6", "https://onedayprint.com.sg/a5-greeting-card/",
        "https://onedayprint.com.sg/a5-greeting-card/a5-greeting-cards-pricing/", "https://onedayprint.com.sg/artwork-specifications-digital-prints/a5-a5-folded/", "https://onedayprint.com.sg/a6-postcard/", "https://onedayprint.com.sg/a6-postcard/postcard-invitation-card-a6-pricing/",
        "https://onedayprint.com.sg/artwork-specifications-digital-prints/a6-a7/", "https://onedayprint.com.sg/custom-certificate/", "https://onedayprint.com.sg/custom-certificate/custom-certificate-pricing/", "https://onedayprint.com.sg/waterproof-synthetic-menu/",
        "https://onedayprint.com.sg/custom-bookmarks/", "https://onedayprint.com.sg/custom-bookmarks/custom-bookmarks-pricing/", "https://onedayprint.com.sg/custom-bookmarks/custom-bookmarks-manuscripts-requirements/", "https://onedayprint.com.sg/artwork-specifications-stickers/",
        "https://onedayprint.com.sg/artwork-specifications-temp-tattoos/", "https://onedayprint.com.sg/typesetting-designing/", "https://onedayprint.com.sg/payment-details/", "https://onedayprint.com.sg/lead-time/",
        "https://onedayprint.com.sg/contact-us/", "https://onedayprint.com.sg/faq/", "https://onedayprint.com.sg/which-material-should-i-choose/"
    ];
  }

  // de-dup
  urls = Array.from(new Set(urls));

  console.log(`Indexing ${urls.length} page(s) → ${collection} (concurrency=${concurrency})`);
  await indexUrls(urls, { collection, concurrency });

  console.log("\nTesting search …");
  await testSearch("PVC vs Synthetic waterproof", collection);
}

// Cross-platform isMain check
const isMain = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "");
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { indexUrls, testSearch };
