// api/compose.js
// Minimal, serverless-friendly handler
// pure proxy to your existing backend
// helper to normalize a field from formidable
function pickField(v, def = "") {
  // v may be undefined | string | string[]
  const raw = Array.isArray(v) ? v[0] : v;
  const s = (raw == null ? "" : String(raw)).trim();
  return (!s || s === "undefined" || s === "null") ? def : s;
}

// normalize helper (keeps real values, strips "", "undefined", "null")
const norm = (v) => {
  const raw = Array.isArray(v) ? v[0] : v;
  const s = (raw == null ? "" : String(raw)).trim();
  return s && s !== "undefined" && s !== "null" ? s : "";
};

export default async function handler(req, res) {
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send("compose alive");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  // // --- quick stub so UI always gets a response while we iterate ---
  // if (!req.headers["content-type"]?.includes("multipart/form-data")) {
  //   // No file upload; just return a stub immediately
  //   return res.status(200).json({ html: "<p>stub ok</p>" });
  // }

  // ---- Parse multipart (PDF) with formidable ----
  // npm i formidable
  const formidable = (await import("formidable")).default;
  const fs = await import("fs/promises");

  try {
    const { fields, files } = await new Promise((resolve, reject) => {
      const form = formidable({ multiples: false, maxFileSize: 10 * 1024 * 1024, fileWriteStreamHandler: () => null });
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
    });
    // after: const { fields, files } = await new Promise(...)

    let text = String(fields?.text || "").trim(); //uitext
    let pdfText = ""; //pdf text

    // pick the first file safely
    let f = files?.file;
    if (Array.isArray(f)) f = f[0];

    if (f?.filepath || f?._writeStream || f?._buffer) {
      const name = String(f.originalFilename || "");
      const type = String(f.mimetype || "");
      const isPdf = /\.pdf$/i.test(name) || /pdf/i.test(type);

      if (isPdf) {
        let fileBuffer;

        // --- Try reading from file system (local dev only) ---
        if (f?.filepath && f?.newFilename) {
          try {
            const fs = await import("fs/promises");
            fileBuffer = await fs.readFile(f.filepath);
          } catch (err) {
            console.warn("⚠️ File not found on serverless, falling back to in-memory buffer.");
          }
        }

        // --- Try in-memory fallbacks for Vercel ---
        if (!fileBuffer && f?._writeStream?.buffer) {
          fileBuffer = f._writeStream.buffer;
        } else if (!fileBuffer && f?._buffer) {
          fileBuffer = f._buffer;
        } else if (!fileBuffer && f?.toJSON?.()._writeStream?.buffer) {
          fileBuffer = f.toJSON()._writeStream.buffer;
        }

        if (fileBuffer) {
          const { default: pdfParse } = await import("pdf-parse");
          const parsed = await pdfParse(fileBuffer);
          pdfText = (parsed.text || "").trim();
        } else {
          console.warn("⚠️ No usable file buffer found for PDF parsing.");
        }
      }
    }

    let merged = "";
    if (text) {
      merged += [
        "TEXTBOX INPUT (Priority: High)",
        "-------------------------------",
        text,
        ""
      ].join("\n");
    }
    if (pdfText) {
      merged += [
        "EXTRACTED PDF TEXT (Priority: Low)",
        "-----------------------------------",
        pdfText
      ].join("\n");
    }
    text = merged.trim(); // merged "text"

    // // after you've built `text` (and picked file `f`)...
    // const intent       = String(fields?.intent);
    // const product      = String(fields?.product);
    // const customerName = String(fields?.customerName || "");

    // const intent       = pickField(fields?.intent, "quote_payment");  // default like local
    // let   product      = pickField(fields?.product, "");              // empty means “unknown”
    // const customerName = pickField(fields?.customerName, "");
    
    // // If product is still empty, classify it (mirror src/index.js behavior)
    // if (!product) {
    //   const { classifyProductAndIntent } = await import("../src/llm.js");
    //   const cls = await classifyProductAndIntent(text);
    //   product = cls.product;   // e.g., "stickers" | "namecards"
    // }

    // keep what the client sent; only default if truly empty
    const intentFromClient  = norm(fields?.intent);   // 'general' from Others page
    let   intent            = intentFromClient || "quote_payment";
    let   product           = norm(fields?.product);
    const customerName      = norm(fields?.customerName);
    const staffName         = norm(fields?.staffName);
    const styleNotes        = norm(fields?.styleNotes);

    // If product is missing, classify ONLY product (don’t overwrite a provided intent)
    if (!product || !intentFromClient) {
      const { classifyProductAndIntent } = await import("../src/llm.js");
      const cls = await classifyProductAndIntent(text || "");
      if (!product && cls?.product) product = cls.product;
      if (!intentFromClient && cls?.intent) intent = cls.intent;
    }

    console.log("[compose]", { intent, product }); // should log 'general' for Others

    // quick debug mode: keep this for troubleshooting
    if (req.query?.debug === "1") {
      return res.status(200).json({
        html: `<pre>name=${f?.originalFilename}
        type=${f?.mimetype}
        size=${f?.size}
        pdf+text length=${text.length}

        ${text.slice(0,400)}</pre>`
      });
    }

    // call your core composer, but guard with a timeout so the function always returns
    const withTimeout = (p, ms, label="task") =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms))]);

    const { composeFromText } = await import("../composeCore.js");
    const { html } = await withTimeout(composeFromText({ text, intent, product, customerName, staffName, styleNotes }),15000, "composeFromText");

    return res.status(200).json({ html });
  } catch (e) {
    console.error("compose error:", e);
    return res.status(200).json({
      html: `<p style="color:#b00020"><strong>Error:</strong> ${String(e.message || e)}</p>`
    });
  }
}