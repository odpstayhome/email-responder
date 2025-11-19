// src/services/emailUtils.js
function extractEmailMetadata(msg) {
  if (!msg) {
    throw new Error("extractEmailMetadata: message is undefined/null");
  }
  if (!msg.payload) {
    // Helpful debug so you see what you actually got back
    throw new Error("extractEmailMetadata: message.payload is missing; did you request format:'full'?");
  }

  const headers = msg.payload.headers ?? [];

  const getHeader = (name) =>
    headers.find(h => String(h.name).toLowerCase() === name.toLowerCase())?.value ?? "";

  const subject = getHeader("Subject");
  const from = getHeader("From");
  const to = getHeader("To");
  const threadId = msg.threadId ?? "";

  // Try to get a readable name from the "From" header
  let customerName = from;
  const m = from.match(/^(.*?)</);
  if (m && m[1]) customerName = m[1].trim();

  // Prefer text/plain part, fall back to any part with data, then empty string
  let bodyText = "";
  const decode = (b64) => Buffer.from(b64, "base64").toString("utf8");

  if (msg.payload.body?.data) {
    bodyText = decode(msg.payload.body.data);
  } else if (Array.isArray(msg.payload.parts)) {
    const plain = msg.payload.parts.find(p => p.mimeType === "text/plain" && p.body?.data);
    const any = msg.payload.parts.find(p => p.body?.data);
    if (plain?.body?.data) bodyText = decode(plain.body.data);
    else if (any?.body?.data) bodyText = decode(any.body.data);
  }

  return { subject, from, to, threadId, customerName, bodyText };
}


export { extractEmailMetadata };
