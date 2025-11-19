// src/index.js (top)
import { authorize } from "./services/googleApiAuthService.js";
import { createReplyDraft, getLatestThread } from "./services/gmailApiServices.js";
import { composeAnswer, extractQuoteFields, classifyProductAndIntent } from "./llm.js"; // <-- changed
import { retrieveSimilar, retrieveSiteSnippets } from "./rag.js";
import { calcQuote } from "./quoteCalc.js";
import { calcBizCardQuote } from "./quoteCalcBizCard.js"; // <-- added
import Handlebars from "handlebars";
import { loadTemplate } from "./services/templateService.js";
import { extractEmailMetadata } from "./services/emailUtils.js";
import { toQuoteInput } from "./util.js";

Handlebars.registerHelper("money", v => Number(v || 0).toFixed(2));

// NEW — treat null/undefined/"" as 0 or a default
Handlebars.registerHelper("nz", (v, defVal) =>
  (v == null || v === "") ? defVal : v
);

// ADD THIS NOW: sum helper
Handlebars.registerHelper("sum", function (...args) {
  const vals = args.slice(0, -1).map(n => Number(n)).filter(Number.isFinite);
  return vals.reduce((a, b) => a + b, 0);
});

// Stronger business-card parser: quantity + sides (1 or 2)
function parseBizCardFields(text = "") {
  const t = String(text || "").toLowerCase();

  // --- QUANTITY ---
  // prefer explicit pack sizes first
  const mQty = t.match(/\b(1000|500|200|100)\b/);
  const quantity = mQty ? Number(mQty[1]) : 100;

  // --- SIDES ---
  // Positive double-sided signals (many variants)
  const doublePatterns = [
    /\bdouble[\s-]*sided?\b/,
    /\b2[\s-]*sides?\b/,                 // "2 sides", "2-side"
    /\btwo[\s-]*sides?\b/,
    /\bduplex\b/,                        // print jargon
    /\b(front\s*&?\s*back)\b/,           // "front & back" / "front and back"
    /\b(front)\s*(\/|and|&)\s*(back)\b/,
    /\b(ds)\b/,                          // shorthand
    /back\.(jpg|jpeg|png|pdf)\b/,        // file hints
  ];

  // Negative single-sided signals (win over weak positives)
  const singlePatterns = [
    /\bsingle[\s-]*sided?\b/,
    /\b1[\s-]*side(d)?\b/,
    /\bone[\s-]*side(d)?\b/,
    /\bfront\s*only\b/,
    /\b(ss)\b/
  ];

  const has = (arr) => arr.some(rx => rx.test(t));

  // Heuristic: if email references both "front" AND "back" anywhere → favor 2 sides
  const mentionsFrontAndBack = /\bfront\b/.test(t) && /\bback\b/.test(t);

  let sides = 1;
  if (has(doublePatterns) || mentionsFrontAndBack) sides = 2;
  if (has(singlePatterns)) sides = 1; // explicit single overrides

  return { quantity, sides };
}

async function processEmail(auth) {
  // 1) Pull latest email/thread + metadata
  const { latestMessage, bodyText } = await getLatestThread(auth);
  const meta = extractEmailMetadata(latestMessage);
  const subject = meta.subject || "(no subject)";
  const recipient = meta.replyTo || meta.fromEmail || meta.from || meta.to;
  const text = `${subject}\n\n${bodyText || ""}`;

  // 2) Classify BOTH product + intent (one call)
  const cls = await classifyProductAndIntent(text);
  const product = cls.product || "other";
  const intent = cls.intent || "general";
  console.log("[routing]", cls);

  let html;

  // 3) Route
  if (product === "stickers") {
    if (intent === "quote_payment") {
      // Extract sticker fields, compute, render STICKER_PAYMENT
      const fields = (await extractQuoteFields(bodyText || "")) || {};
      const rawCut = String(fields.cut_type || fields.cutType || fields.finish || fields.cut || "")
        .trim().toLowerCase();

      const quoteInput = {
        ...toQuoteInput(fields),
        individualCut: rawCut === "individual-cut",
        dieCut:        rawCut === "die-cut",
      };
      const quote = calcQuote(quoteInput);

      const tpl = await loadTemplate("STICKER_PAYMENT");
      html = tpl({
        customerName: meta.customerName,
        quotes: [{
          ...quote,
          material: quote.materialLabel || quoteInput.material,
          shape: quoteInput.shape,
          shapeNice: quoteInput.shape === "Round" ? "Circular" : quoteInput.shape,
          sizeNice: quoteInput.shape === "Round"
            ? `${quoteInput.widthMm}mm diameter`
            : `${quoteInput.widthMm}mm (W) X ${quoteInput.heightMm}mm (H)`,
          widthMm: quoteInput.widthMm,
          heightMm: quoteInput.heightMm,
        }],
        total: Number(quote.total || 0),
        courier: false,
        courierPrice: 0,
        courierTotal: Number(quote.total || 0),
        // optional body section from RAG (kept from your flow)
        body: await composeAnswer(text, [
          ...await retrieveSiteSnippets(text, 6),
          ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
        ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`)),
      });

    } else {
      // STICKER_NO_QUOTE
      const tpl = await loadTemplate("STICKER_NO_QUOTE");
      const body = await composeAnswer(text, [
        ...await retrieveSiteSnippets(text, 6),
        ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
      ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`));
      html = tpl({ customerName: meta.customerName, body });
    }

  } else if (product === "namecards") {
    if (intent === "quote_payment") {
      // Parse simple fields (qty/sides), compute, render NAMECARDS
      const { quantity, sides } = parseBizCardFields(text);
      const q = calcBizCardQuote({ quantity, sides });
      const body = await composeAnswer(text, [
        ...await retrieveSiteSnippets(text, 6),
        ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
      ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`));
      const tpl = await loadTemplate("NAMECARDS");

      html = tpl({
        customerName: meta.customerName,
        body,
        // your placeholders requested earlier:
        DS: sides === 2 ? "Double Sided" : "Single Sided",
        quantity: q.quantityCharged, // rounds up to supported pack
        front: q.front,                                  // << use calc output
        back:  sides === 2 ? q.back : undefined,         // << use calc output
        total: `S$${Number(q.total).toFixed(2)}`,
        // extra fields if your template needs them:
        unitPrice: q.unitPrice,
        sides,
        notes: q.notes,
      });

    } else {
      // NAMECARDS_QUOTE
      const tpl = await loadTemplate("NAMECARDS_QUOTE");
      const body = await composeAnswer(text, [
        ...await retrieveSiteSnippets(text, 6),
        ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
      ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`));
      html = tpl({ customerName: meta.customerName, body });
    }

  } else {
    // 4) GENERAL_OTHERS (not stickers/namecards)
    const tpl = await loadTemplate("GENERAL_OTHERS");
    const body = await composeAnswer(text, [
      ...await retrieveSiteSnippets(text, 6),
      ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
    ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`));
    html = tpl({ customerName: meta.customerName, body });
  }

  // 5) Draft reply
  await createReplyDraft({ to: recipient, subject, body: html, threadId: meta.threadId }, auth);
  console.log(`Draft created for thread ${meta.threadId} → ${recipient}`);
}

// boilerplate main()
async function main() {
  const auth = await authorize();
  await processEmail(auth);
}
main();