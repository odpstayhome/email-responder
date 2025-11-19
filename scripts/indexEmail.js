//this to push indexed email to qdrant, cos aft i embed i realise nth is stored in qdrant so need this lols
// scripts/indexEmails.js
//not related to main process
import 'dotenv/config';
import { google } from 'googleapis';
import { authorize } from '../src/services/googleApiAuthService.js';
import { indexEmails } from '../src/rag.js';

const QUERY = process.env.RAG_INDEX_QUERY || 'in:sent newer_than:365d';
const MAX = Number(process.env.RAG_INDEX_MAX || 300);

// add near the top of scripts/indexEmails.js
const CHUNK_SIZE = 3000;   // characters per chunk (~1000 tokens)
const CHUNK_OVERLAP = 300; // overlap for continuity

function chunkText(s) {
  const out = [];
  if (!s) return out;
  for (let i = 0; i < s.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
    out.push(s.slice(i, i + CHUNK_SIZE));
  }
  return out;
}

function b64urlDecode(s='') {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractPlainText(msg) {
  const walk = (p) => {
    if (!p) return '';
    if (p.mimeType?.toLowerCase() === 'text/plain' && p.body?.data) return b64urlDecode(p.body.data);
    if (p.parts) {
      for (const child of p.parts) {
        const got = walk(child);
        if (got) return got;
      }
    }
    if (p.mimeType?.toLowerCase() === 'text/html' && p.body?.data) {
      return b64urlDecode(p.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return p.body?.data ? b64urlDecode(p.body.data) : '';
  };
  return walk(msg.payload) || msg.snippet || '';
}

function header(msg, name) {
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

async function listMessageIds(gmail, { q, max }) {
  const ids = [];
  let pageToken;
  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: Math.min(100, Math.max(1, max - ids.length)),
      pageToken
    });
    (res.data.messages || []).forEach(m => ids.push(m.id));
    pageToken = res.data.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids;
}

async function readMessages(gmail, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const got = await Promise.all(batch.map(id => gmail.users.messages.get({ userId: 'me', id, format: 'full' })));
    out.push(...got.map(r => r.data));
  }
  return out;
}

async function run() {
    const auth = await authorize();
    const gmail = google.gmail({ version: 'v1', auth });

    console.log(`[RAG] Query: "${QUERY}", limit: ${MAX}`);
    const ids = await listMessageIds(gmail, { q: QUERY, max: MAX });
    if (!ids.length) {
        console.log('[RAG] No messages matched query.');
        return;
    }

    const msgs = await readMessages(gmail, ids);
    // after you built `msgs`, before indexing:
    const docs = [];
    for (const m of msgs) {
    const subject = header(m, 'Subject') || '(no subject)';
    const body = extractPlainText(m);
    const base = {
        subject,
        threadId: m.threadId,
        label: (m.labelIds || []).join(','),
        timestamp: Number(m.internalDate || Date.now())
    };
    const chunks = chunkText(body);

    // If short, store single point; if long, store multiple with suffixes
    if (chunks.length === 0) continue;
    if (chunks.length === 1) {
        docs.push({ id: m.id, body: chunks[0], ...base });
    } else {
        chunks.forEach((c, idx) => {
        docs.push({ id: `${m.id}#${idx+1}`, body: c, ...base, chunk: idx+1, chunks: chunks.length });
        });
    }
    }

    console.log(`[RAG] Prepared ${docs.length} chunks → indexing…`);
    await indexEmails(docs);

    console.log('[RAG] Ingestion complete ✅');
}

run().catch(err => {
  console.error('[RAG] Ingestion failed:', err);
  process.exit(1);
});
