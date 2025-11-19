// src/services/googleApiServices.js
import { google } from "googleapis";
import * as XLSX from "xlsx";
// helper: decode + extract readable text from a Gmail message
function decodeBase64Url(b64 = "") {
  return Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}
function stripHtml(html = "") {
  return html.replace(/<\/?[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function getTextFromMessage(msg) {
  const payload = msg?.payload;
  if (!payload) return "";

  let texts = [];

  // walk parts recursively (handles nested multiparts)
  (function walk(part) {
    if (!part) return;
    const { mimeType, body, parts } = part;

    if (mimeType === "text/plain" && body?.data) {
      texts.push(decodeBase64Url(body.data));
    } else if (mimeType === "text/html" && body?.data) {
      texts.push(stripHtml(decodeBase64Url(body.data)));
    }
    if (Array.isArray(parts)) parts.forEach(walk);
  })(payload);

  // sometimes the body is directly in payload.body.data
  if (texts.length === 0 && payload.body?.data) {
    texts.push(decodeBase64Url(payload.body.data));
  }
  return texts.join("\n").trim();
}

// ✅ Get latest message + the **entire thread**
async function getLatestThread(auth) {
  const gmail = google.gmail({ version: "v1", auth });

  // 1) Get the most recent message (in Inbox)
  const list = await gmail.users.messages.list({
    userId: "me",
    maxResults: 1,
    q: "in:inbox",
  });
  if (!list.data.messages?.length) throw new Error("No messages in Inbox");

  const id = list.data.messages[0].id;

  // 2) Fetch that message (to read its threadId)
  const msgRes = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });
  const latestMessage = msgRes.data;
  const threadId = latestMessage.threadId;

  // 3) Fetch the **whole thread**
  const threadRes = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full", // get full payloads for all messages
  });

  const thread = threadRes.data; // { id, messages: [...] }

  // 4) Build a combined plain-text body for the thread (newest last)
  const messages = thread.messages || [];
  // const bodies = messages.map(getTextFromMessage);
  // let combinedBody = bodies.filter(Boolean).join("\n\n---\n\n");

  // // 5) Collect attachments from the latest message
  // const attachments = [];

  ///////////////////////////////////////////////////////////////////////////////////////////// this is to read file attachments within same thread up to 3 privious msgs
  // Build thread body (oldest->newest)
  const bodies = messages.map(getTextFromMessage);
  let combinedBody = bodies.filter(Boolean).join("\n\n---\n\n");

  // Collect & parse attachments from the **last three** messages
  const lastThreeMessages = messages.slice(-3);

  // Download attachments
  const attachmentGroups = await Promise.all(
    lastThreeMessages.map(m => getAttachmentsForMessage(gmail, m))
  );
  // Flatten for parsing and also keep a map by message
  const attachments = attachmentGroups.flat();

  // NEW: tiny renderer for an attachments block
  function renderAttachmentsBlock(groups) {
    // groups: [{ messageId, internalDate, items: [{filename, textContent}]}]
    const lines = [];
    for (const g of groups) {
      const when = g.internalDate ? new Date(Number(g.internalDate)).toISOString() : "";
      lines.push(`### Attachments from message ${g.messageId} (${when})`);
      if (!g.items.length) {
        lines.push("(no supported attachments)\n");
        continue;
      }
      for (const item of g.items) {
        const label = `[${item.filename}]`;
        const text = (item.textContent || "").trim();
        lines.push(`${label}\n${text}\n`);
      }
      lines.push(""); // spacer
    }
    return lines.join("\n");
  }

  // NEW: walk MIME parts recursively to find real attachments
  function* walkParts(parts = []) {
    for (const p of parts) {
      if (!p) continue;
      if (p.filename && p.body?.attachmentId) yield p;
      if (Array.isArray(p.parts)) yield* walkParts(p.parts);
    }
  }

  // NEW: download all attachments for a single Gmail message (format=full)
  async function getAttachmentsForMessage(gmail, message) {
    const out = [];
    const parts = message?.payload?.parts || [];
    for (const part of walkParts(parts)) {
      const attachmentId = part.body.attachmentId;
      const attachmentRes = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: message.id,
        id: attachmentId,
      });

      const dataBuf = Buffer.from(
        String(attachmentRes.data.data || "").replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      );

      out.push({
        messageId: message.id,                    // helpful for tracing
        internalDate: message.internalDate,       // ms since epoch (string)
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body.size ?? dataBuf.length,
        data: dataBuf,
      });
    }
    return out;
  }

  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  const parts = latestMessage.payload?.parts || [];
  for (const part of parts) {
    if (part.filename && part.body?.attachmentId) {
      const attachmentRes = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: latestMessage.id,
        id: part.body.attachmentId,
      });

      const fileData = Buffer.from(
        attachmentRes.data.data.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      );

      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body.size,
        data: fileData,
      });
    }
  }

  // attachments[] is what you already built
  // to read .xlsx file only\
  let textContent = "";  
  // Lazy-load pdf-parse only when needed
  async function extractPdfText(buffer) {
    const { default: pdfParse } = await import('pdf-parse');
    const res = await pdfParse(buffer);   // { text, numpages, ... }
    // collapse whitespace a bit (optional)
    return (res.text || "").replace(/\s+\n/g, "\n").trim();
  }

  // Lazy OCR for images (jpeg/png)
  // OCR for JPEG/PNG using tesseract.js
  async function extractImageText(buffer) {
    const { default: Tesseract } = await import("tesseract.js"); // <-- default export
    const res = await Tesseract.recognize(buffer, "eng");        // use .recognize on default
    return (res?.data?.text || "").trim();
  }

  for (const att of attachments) {
    const name = (att.filename || "").toLowerCase();
    const mime = att.mimeType || "";

    const isExcel =
      name.endsWith(".xlsx") ||
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    const isPdf =
      name.endsWith(".pdf") ||
      mime === "application/pdf";

    const isImage =
      name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") ||
      mime === "image/jpeg" || mime === "image/png";

    try {
      if (isExcel) {
        const workbook = XLSX.read(att.data, { type: "buffer" });
        const allSheets = workbook.SheetNames.map((sheetName) => {
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
          return { sheet: sheetName, rows };
        });

        const extracted = allSheets
          .map(({ sheet, rows }) => `Sheet: ${sheet}\n${rows.map(r => r.join(", ")).join("\n")}`)
          .join("\n\n");

        console.log(`Extracted from ${att.filename}:\n`, extracted.slice(0, 500), "...");
        att.textContent = extracted;
        textContent += `\n\n[Attachment: ${att.filename}]\n${extracted}`;

      } else if (isPdf) {
        const pdfText = await extractPdfText(att.data);
        const preview = pdfText.slice(0, 500);
        console.log(`Extracted (PDF) from ${att.filename}:\n`, preview, pdfText.length > 500 ? "..." : "");
        att.textContent = pdfText;
        textContent += `\n\n[Attachment: ${att.filename}]\n${pdfText}`;

      }  else if (isImage) {
        const imgText = await extractImageText(att.data);
        const preview = imgText.slice(0, 500);
        console.log(`Extracted (IMAGE OCR) from ${att.filename}:\n`, preview, imgText.length > 500 ? "..." : "");
        att.textContent = imgText;
        textContent += `\n\n[Attachment: ${att.filename}]\n${imgText}`;
        console.log(textContent);

      } else {
        console.log(`Skipping non-Excel/PDF attachment: ${att.filename}`);
      }
    } catch (err) {
      console.error(`Failed to parse attachment ${att.filename}`, err);
    }
  }

  // // 🔑 Merge attachment text into combinedBody
  // if (textContent) {
  //   combinedBody += "\n\n--- Attachments ---\n" + textContent;
  // }

  // // 🔑 Merge attachment text at the TOP of combinedBody
  // if (textContent) {
  //   combinedBody = [
  //     "--- Attachments ---",
  //     textContent,
  //     "",
  //     "---",
  //     "",
  //     combinedBody
  //  ].join("\n");
  // }

  // Group parsed attachments by message, preserving the last-3 order
  const attachmentsByMessage = lastThreeMessages.map(m => ({
    messageId: m.id,
    internalDate: m.internalDate,
    items: attachments.filter(a => a.messageId === m.id),
  }));
  // 🔴 Inject attachments directly **into** combinedBody
  const attachmentsBlock = renderAttachmentsBlock(attachmentsByMessage);
  if (attachmentsBlock.trim()) {
    combinedBody = [
      "----- BEGIN ATTACHMENTS (last 3 messages) -----",
      attachmentsBlock,
      "----- END ATTACHMENTS -----",
      "",
      combinedBody, // original email bodies below
    ].join("\n");
  }

  return {
    thread,               // all messages in the convo
    latestMessage,        // the same one you had before
    bodyText: combinedBody, // whole chain text (good for LLM/RAG)
  };
}

//createReplyDraft
/**
 * Create a Gmail draft reply in the same thread.
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.subject - Subject line
 * @param {string} params.body - HTML or plain text body
 * @param {string} params.threadId - Gmail thread ID
 */
async function createReplyDraft({ to, subject, body, threadId }, auth) {
  const gmail = google.gmail({ version: "v1", auth });

  // Optional: sanitize subject (no newlines)
  const safeSubject = String(subject || "").replace(/\r?\n/g, " ").trim();

  const lines = [
    `To: ${to}`,
    `Subject: Re: ${safeSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    '', // blank line separates headers from body
    '<!DOCTYPE html><html><body>',
    body, // already-rendered Handlebars HTML
    '</body></html>'
  ];

  const raw = Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { threadId, raw } }
  });
}


export { getLatestThread, createReplyDraft };
