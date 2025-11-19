// composeCore.js (ESM)
// basically the index.js logic but as a module we can import
// and without gmail-specific stuff like drafts, threads etc
import { classifyProductAndIntent, composeAnswer, extractQuoteFields, composeAnswerforOthers, findLatestAddr } from "./src/llm.js";
import { retrieveSimilar, retrieveSiteSnippets } from "./src/rag.js";
import { calcQuote } from "./src/quoteCalc.js";
import { calcBizCardQuote } from "./src/quoteCalcBizCard.js";
import { loadTemplate } from "./src/services/templateService.js";
import { toQuoteInput, normShape } from "./src/util.js";
import Handlebars from "handlebars";

// strict equality (works in subexpressions like {{#if (eq a b)}})
Handlebars.registerHelper("eq", (a, b) => String(a) === String(b));

// currency helper: formats as S$0.00 and tolerates empty/NaN
Handlebars.registerHelper("money", (v) => {
  const n = Number(v);
  const amt = Number.isFinite(n) ? n : 0;
  return `$${amt.toFixed(2)}`;
});

// NEW — treat null/undefined/"" as 0 or a default
Handlebars.registerHelper("nz", (v, defVal) =>
  (v == null || v === "") ? defVal : v
);

// ADD THIS NOW: sum helper
Handlebars.registerHelper("sum", function (...args) {
  const vals = args.slice(0, -1).map(n => Number(n)).filter(Number.isFinite);
  return vals.reduce((a, b) => a + b, 0);
});

// even stronger business-card parser: quantities[] + sides (1 or 2)
function parseBizCardFields(text = "") {
  const t = String(text || "").toLowerCase().replace(/\u00d7/g, "x"); // normalize "×" to "x"

  // --- helper: round to allowed packs ---
  const ALLOWED = [100,200,300,400,500,600,700,800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000];

  // --- 1) explicit “X names x N each” OR “N pcs x X names” patterns ---
  // e.g. "2 names x 100 each", "2 names x 100", "100 pcs x 2 names"
  const rxNamesEachA = /\b(\d+)\s*(?:names?|persons?|people|sets|boxes)\s*(?:x|\*)\s*(\d+)\s*(?:pcs|pieces|cards)?(?:\s*each)?\b/;
  const rxNamesEachB = /\b(\d+)\s*(?:pcs|pieces|cards)?\s*(?:x|\*)\s*(\d+)\s*(?:names?|persons?|people|sets|boxes)\b/;

  let quantities = [];
  let m = t.match(rxNamesEachA) || t.match(rxNamesEachB);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    const count = /names?|persons?|people|sets|boxes/.test(m[0]) && rxNamesEachA.test(m[0]) ? a : b;
    const each  = /pcs|pieces|cards/.test(m[0]) && rxNamesEachB.test(m[0]) ? a : b;
    const pack  = (each % 100 === 0 && each >= 100 && each <= 2000) ? each : 100;
    quantities = Array.from({ length: count }, () => pack);
  }

  // --- 2) delimited list of pack sizes: "100 + 100", "100, 200", "100 / 200" ---
  if (quantities.length === 0) {
    const matches = [...t.matchAll(/\b(100|200|300|400|500|600|700|800|900|1000|1100|1200|1300|1400|1500|1600|1700|1800|1900|2000)\b/g)].map(m => Number(m[1]));
    // If multiple pack tokens appear, treat each as a front
    if (matches.length > 1) {
      quantities = matches.slice(0, 10);
    } else if (matches.length === 1) {
      quantities = [matches[0]];
    }
  }

  // --- 3) default if nothing matched ---
  if (quantities.length === 0) quantities = [100];

  // Keep backward compatibility
  // (your existing call sites may still read `quantity`)
  const quantity = quantities[0];

  // --- SIDES (unchanged) ---
  const doublePatterns = [
    /\bdouble[\s-]*sided?\b/,
    /\b2[\s-]*sides?\b/,
    /\b2[\s-]*side?\b/,
    /\b2[\s-]*sided?\b/,
    /\btwo[\s-]*sides?\b/,
    /\btwo[\s-]*sided?\b/,
    /\bduplex\b/,
    /\b(front\s*&?\s*back)\b/,
    /\b(front)\s*(\/|and|&)\s*(back)\b/,
    /\b(ds)\b/,
    /back\.(jpg|jpeg|png|pdf)\b/,
  ];
  const singlePatterns = [
    /\bsingle[\s-]*sided?\b/,
    /\b1[\s-]*side(d)?\b/,
    /\b1[\s-]*sides?\b/,
    /\bone[\s-]*side(d)?\b/,
    /\bfront\s*only\b/,
    /\b(ss)\b/
  ];
  const has = (arr) => arr.some(rx => rx.test(t));
  const mentionsFrontAndBack = /\bfront\b/.test(t) && /\bback\b/.test(t);
  let sides = 1;
  if (has(doublePatterns) || mentionsFrontAndBack) sides = 2;
  if (has(singlePatterns)) sides = 1;

  return { quantity, quantities, sides };
}

// --- Courier fee helper (first 2 digits) ---
function getCourierFeeByPostal(postalCode = "") {
  const first2 = postalCode.slice(0, 2);
  // Example Singapore zones — customise rates as you wish
  const zoneMap = {
    // 01–10 : $12
    "01":12,"02":12,"03":12,"04":12,"05":12,"06":12,"07":12,"08":12,"09":12,"10":12,

    // 11–13 : $15
    "11":15,"12":15,"13":15,

    // 14–33 : $12
    "14":12,"15":12,"16":12,"17":12,"18":12,"19":12,"20":12,"21":12,"22":12,"23":12,
    "24":12,"25":12,"26":12,"27":12,"28":12,"29":12,"30":12,"31":12,"32":12,"33":12,

    // 34–55 : $10
    "34":10,"35":10,"36":10,"37":10,"38":10,"39":10,"40":10,"41":10,"42":10,"43":10,
    "44":10,"45":10,"46":10,"47":10,"48":10,"49":10,"50":10,"51":10,"52":10,"53":10,
    "54":10,"55":10,

    // 56–59 : $12
    "56":12,"57":12,"58":12,"59":12,

    // 60–73 : $15
    "60":15,"61":15,"62":15,"63":15,"64":15,"65":15,"66":15,"67":15,"68":15,"69":15,
    "70":15,"71":15,"72":15,"73":15,

    // 75–80 : $12
    "75":12,"76":12,"77":12,"78":12,"79":12,"80":12,

    // 81–82 : $10
    "81":10,"82":10,
  };
  return zoneMap[first2] ?? 12; // default courier fee
}

// Derive the quantity expression from the raw text and pass it through. Tiny extractor and then overwrite quoteInput.quantityExpr before you call calcQuote()
function extractQtyExprFromText(text = "") {
  const t = String(text || "");
  //console.log(text);

  // Separate sections by labels if present
  const uiPart  = t.match(/TEXTBOX INPUT[\s\S]*?(?=EXTRACTED PDF TEXT|$)/i)?.[0] || "";
  const pdfPart = t.match(/EXTRACTED PDF TEXT[\s\S]*$/i)?.[0] || "";

  // Define a helper to extract expression from plain text
  const extractCore = (src) => {
    const lines = src.toLowerCase().replace(/\u00d7/g, "x").split(/\r?\n/);
    let bestExpr = null, bestScore = -1;
    for (const raw of lines) {
      const line = raw.trim();
      if (/(mm|cm|diam|diameter|gsm|pt|a\d\b)/.test(line)) continue;

      const parts = [], seen = new Set(); let score = 0;
      for (const m of line.matchAll(/(\d{1,5})\s*[x*]\s*(\d{1,5})/g)) {
        const a = +m[1], b = +m[2];
        parts.push(`${a}x${b}`); seen.add(`L${a}`); seen.add(`R${b}`); score += 2;
      }
      for (const m of line.matchAll(/(\d{1,5})\s*designs?\s*[x*]\s*(\d{1,5})/g)) {
        const a = +m[1], b = +m[2];
        if (!seen.has(`L${a}`) || !seen.has(`R${b}`)) { parts.push(`${a}x${b}`); score += 2; }
        seen.add(`L${a}`); seen.add(`R${b}`);
      }
      for (const m of line.matchAll(/(\d{1,5})(?:\s*(pcs|pieces|pc))?/g)) {
        const n = +m[1];
        if (!seen.has(`L${n}`) && !seen.has(`R${n}`)) { parts.push(String(n)); score += 1; }
      }

      if (parts.length && score > bestScore) {
        bestExpr = parts.join(" + ").replace(/\s+/g, "");
        bestScore = score;
      }
    }
    return bestExpr;
  };

  // 1️⃣ Try UI first
  let expr = extractCore(uiPart);
  // // 2️⃣ Fallback to PDF if nothing found
  // if (!expr) expr = extractCore(pdfPart);
  // // 3️⃣ Final fallback (no labels)
  // if (!expr) expr = extractCore(t);

  return expr || null;
}

// detect white ink
function detectTransparency(rawText = "") {
  const t = `${rawText}`.toLowerCase();

  // direct cues
  const hasTransparentWord = /\btransparent\b/.test(t) || /\bclear\b/.test(t) || /\bsee[-\s]?through\b/.test(t);

  // white ink cues imply a transparent/clear substrate
  const hasWhiteInk = /\bwhite\s*(?:ink|underlay|base|backing)\b/.test(t);

  const isTransparent = hasTransparentWord || hasWhiteInk;
  return { isTransparent, hasWhiteInk };
}

export async function composeFromText({ text, intent, product, customerName, staffName, styleNotes }) {

  // If caller passes intent/product, use them; otherwise classify
  const p = product;
  const i = intent;
  let html;
  console.log(i);
  console.log(p);
  // so that if general is asked but is also a sticker/namecard
  if (i === "general") {
    const tpl = await loadTemplate("GENERAL_OTHERS");
    const body = await composeAnswerforOthers(text, [
      ...await retrieveSiteSnippets(text, 6),
      ...((await retrieveSimilar(text, 3)) || [])
        .map(n => n.body?.slice(0, 280))
        .filter(Boolean)
    ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`) ,{ styleNotes },);
    const bodyHtml = body.replace(/\n/g, "<br>");
    const html = tpl({ customerName, body:bodyHtml, staffName });
    return { html };
  }

  // ---- NEW: handle Paid Courier intent ----
  // extract addr from llm, put into handelbars templates, inject into frontend to display
  if (i === "paid_courier") {
    const addr = await findLatestAddr(text);
    const tpl = await loadTemplate("PAID_COURIER");
    const html = tpl({
      customerName,
      staffName,
      ...addr, // spread JSON fields directly for {{AddressName}}, {{customerName}}, etc.
    });
    return { html };
  }

  if (p === "stickers") {
    if (i === "quote_payment") {
      const fields = (await extractQuoteFields(text || "")) || {};
      const rawCut = String(fields.cut_type || fields.cutType || fields.finish || fields.cut || "")
        .trim().toLowerCase();
      // quoteInput is all the input fields
      const quoteInput = {
        ...toQuoteInput(fields),
        individualCut: rawCut === "individual-cut",
        dieCut:        rawCut === "die-cut",
      };
      const exprFromText = extractQtyExprFromText(text);
      if (exprFromText) quoteInput.quantityExpr = exprFromText;
      // debuggin line for TOTAL quantity
      //console.log("[debug text]", text.slice(0, 500));
      //console.log("[qty expr]", extractQtyExprFromText(text));
      //console.log("[qty]", { expr: quoteInput.quantityExpr });
      //debuggin line for shape
      //console.log('[extract]', {
      //  shape: fields.shape,
      //  shape_variants: fields.shape_variants
      //});

      // const quote = calcQuote(quoteInput);
      // const tpl = await loadTemplate("STICKER_PAYMENT");
      // html = tpl({
      //   customerName,
      //   quotes: [{
      //     ...quote,
      //     material: quote.materialLabel || quoteInput.material,
      //     shape: quoteInput.shape,
      //     shapeNice: quoteInput.shape === "Round" ? "Circular" : quoteInput.shape,
      //     sizeNice: quoteInput.shape === "Round"
      //       ? `${quoteInput.widthMm}mm diameter`
      //       : `${quoteInput.widthMm}mm (W) X ${quoteInput.heightMm}mm (H)`,
      //   }],
      //   total: Number(quote.total || 0),
      //   courier: false,
      //   courierPrice: 0,
      //   courierTotal: Number(quote.total || 0),
      //   body: await composeAnswer(text, [
      //     ...await retrieveSiteSnippets(text, 6),
      //     ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
      //   ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`)),
      //   staffName,
      // });
      const mats = (fields.material_variants?.length > 1)
        ? fields.material_variants
        : (fields.material ? [fields.material] : []);

      const sizes = (fields.size_variants?.length > 1)
        ? fields.size_variants
        : ((fields.width_mm && fields.height_mm)
            ? [{ width_mm: fields.width_mm, height_mm: fields.height_mm }]
            : []);

      const shapes = (fields.shape_variants?.length > 1)
        ? fields.shape_variants.map(normShape) 
        : [normShape(fields.shape || quoteInput.shape)].filter(Boolean);

      const baseMat  = mats[0]  || fields.material || quoteInput.material;
      const baseSize = sizes[0] || { width_mm: fields.width_mm ?? quoteInput.widthMm,
                                    height_mm: fields.height_mm ?? quoteInput.heightMm };
      const baseShape = shapes[0] || fields.shape || quoteInput.shape;

      let combos;
      if (mats.length > 1) {
        combos = mats.map(m => ({
          material: m,
          width_mm: baseSize.width_mm,
          height_mm: baseSize.height_mm,
          shape: baseShape,
        }));
      } else if (sizes.length > 1) {
        combos = sizes.map(s => ({
          material: baseMat,
          width_mm: s.width_mm,
          height_mm: s.height_mm,
          shape: baseShape,
        }));
      } else if (shapes.length > 1) {
        combos = shapes.map(sh => ({
          material: baseMat,
          width_mm: sh.width_mm,
          height_mm: sh.height_mm,
          shape: normShape(sh),
        }));
      } else {
        combos = [{
          material: baseMat,
          width_mm: baseSize.width_mm,
          height_mm: baseSize.height_mm,
          shape: baseShape,
        }];
      }

      const varyByMaterial = mats.length > 1;
      const varyBySize     = !varyByMaterial && sizes.length > 1;
      const varyByShape    = !varyByMaterial && !varyBySize && shapes.length > 1;
      const allowMultiDesign = !(varyByMaterial || varyBySize || varyByShape); // only when single material & single size
      const { isTransparent, hasWhiteInk } = detectTransparency(text);
      const quotes = combos.map(v => {
        const q = calcQuote({
          ...quoteInput,
          material: v.material,
          materialId: v.material.toLowerCase(),
          widthMm: v.width_mm,
          heightMm: v.height_mm,
          shape: v.shape,
          flags: { isTransparent, hasWhiteInk }
          //designCount: allowMultiDesign ? quoteInput.designCount : 1, // for design count to be separated from total quantity
        });
        const sizeNice = v.shape === "Round"
          ? `${v.width_mm}mm diameter`
          : `${v.width_mm}mm (W) X ${v.height_mm}mm (H)`;
        
        //this is for the green "file artwork" text only in sticker quote
        const shapeAbbr   = v.shape === "Rectangle" ? "Rect" : v.shape;
        const sizeToken   = v.shape === "Round" ? `${v.width_mm}mm_diameter`
                                                : `${v.width_mm}x${v.height_mm}mm`;
        const materialTok = String(v.material).replace(/\s+/g, "");

        const designCount = Number(q.designCount ?? v.designCount ?? 1);
        const baseName = `${q.quantity}pcs_${sizeToken}_${materialTok}_${shapeAbbr}`
          .replace(/\s+/g, ""); // nuke any stray spaces
        
        return {
          ...q,
          material: q.materialLabel || v.material,
          individualCutCost: q.quantity * 0.20,
          dieCutCost:        q.quantity * 0.25,
          shape: v.shape,
          shapeNice: v.shape === "Round" ? "Circular" : v.shape,
          sizeNice,
          widthMm: v.width_mm,
          heightMm: v.height_mm,
          designCount,
          isMulti: designCount > 1,
          designs: designCount > 1 ? Array.from({ length: designCount }, (_, i) => i + 1) : [],
          baseName,
        };
      });
      
      const grandTotal = quotes.reduce((acc, q) => acc + (Number(q.total) || 0), 0); //acc is accumulator for each quote from multiple quotes
      // --- Detect courier request and compute fee ---
      const courierRequested = /courier|delivery|send\s+to|ship\s+to/i.test(text);
      let courierPrice = 0;
      let courierPostal = "";
      let addr = null;

      if (courierRequested) {
        addr = await findLatestAddr(text);  // already in llm.js
        courierPostal = addr.AddressPostalCode || "";
        courierPrice = getCourierFeeByPostal(courierPostal);
      }

      const courierTotal = courierRequested ? grandTotal + courierPrice : grandTotal;

      const tpl = await loadTemplate("STICKER_PAYMENT");
      const body = await composeAnswer(text, [
          ...await retrieveSiteSnippets(text, 6),
          ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
        ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`));
      const bodyHtml = body.replace(/\n/g, "<br>");
      html = tpl({
        customerName: quoteInput.customerName,
        quotes,                 // ← NOW multiple lines will render
        total: grandTotal,     // a grand total so each variant does not stands alone
        courier: courierRequested,
        courierPrice,
        courierPostal,
        courierTotal,
        body: bodyHtml,
        ...(addr || {}), // spread JSON fields directly for {{AddressName}}, {{customerName}}, etc.
        staffName,
      });
    } else if (i === "quote"){
      const fields = (await extractQuoteFields(text || "")) || {};
      const rawCut = String(fields.cut_type || fields.cutType || fields.finish || fields.cut || "")
        .trim().toLowerCase();
      // quoteInput is all the input fields
      const quoteInput = {
        ...toQuoteInput(fields),
        individualCut: rawCut === "individual-cut",
        dieCut:        rawCut === "die-cut",
      };
      const exprFromText = extractQtyExprFromText(text);
      if (exprFromText) quoteInput.quantityExpr = exprFromText;
      // Build ask flags (only show a question if we DON’T already know it)
      const ask = {
        usage: !(fields.usage_known === true),
        distribution: !(fields.distribution_known === true),
        material: !(fields.material_known === true || fields.material),
      };
      // const quote = calcQuote(quoteInput);
      // const tpl = await loadTemplate("STICKER_QUOTE");
      // html = tpl({
      //   customerName,
      //   quotes: [{
      //     ...quote,
      //     material: quote.materialLabel || quoteInput.material,
      //     shape: quoteInput.shape,
      //     shapeNice: quoteInput.shape === "Round" ? "Circular" : quoteInput.shape,
      //     sizeNice: quoteInput.shape === "Round"
      //       ? `${quoteInput.widthMm}mm diameter`
      //       : `${quoteInput.widthMm}mm (W) X ${quoteInput.heightMm}mm (H)`,
      //   }],
      //   total: Number(quote.total || 0),
      //   courier: false,
      //   courierPrice: 0,
      //   courierTotal: Number(quote.total || 0),
      //   body: await composeAnswer(text, [
      //     ...await retrieveSiteSnippets(text, 6),
      //     ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
      //   ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`)),
      //   staffName,
      // });
      // --- Build variants: MATERIAL wins if multiple; else SIZE; never cross-product ---
      const mats = (fields.material_variants?.length > 1)
        ? fields.material_variants
        : (fields.material ? [fields.material] : []);

      const sizes = (fields.size_variants?.length > 1)
        ? fields.size_variants
        : ((fields.width_mm && fields.height_mm)
            ? [{ width_mm: fields.width_mm, height_mm: fields.height_mm }]
            : []);

      const shapes = (fields.shape_variants?.length > 1)
        ? fields.shape_variants.map(normShape)
        : [normShape(fields.shape || quoteInput.shape)].filter(Boolean);

      const baseMat  = mats[0]  || fields.material || quoteInput.material;
      const baseSize = sizes[0] || { width_mm: fields.width_mm ?? quoteInput.widthMm,
                                    height_mm: fields.height_mm ?? quoteInput.heightMm };
      const baseShape = shapes[0] || fields.shape || quoteInput.shape;

      let combos;
      if (mats.length > 1) {
        combos = mats.map(m => ({
          material: m,
          width_mm: baseSize.width_mm,
          height_mm: baseSize.height_mm,
          shape: baseShape,
        }));
      } else if (sizes.length > 1) {
        combos = sizes.map(s => ({
          material: baseMat,
          width_mm: s.width_mm,
          height_mm: s.height_mm,
          shape: baseShape,
        }));
      } else if (shapes.length > 1) {
        combos = shapes.map(sh => ({
          material: baseMat,
          width_mm: baseSize.width_mm,
          height_mm: baseSize.height_mm,
          shape: sh,
        }));
      } else {
        combos = [{
          material: baseMat,
          width_mm: baseSize.width_mm,
          height_mm: baseSize.height_mm,
          shape: baseShape,
        }];
      }

      const varyByMaterial = mats.length > 1;
      const varyBySize     = !varyByMaterial && sizes.length > 1;
      const varyByShape    = !varyByMaterial && !varyBySize && shapes.length > 1;
      const allowMultiDesign = !(varyByMaterial || varyBySize || varyByShape); // only when single material & single size
      const { isTransparent, hasWhiteInk } = detectTransparency(text);
      const quotes = combos.map(v => {
        const q = calcQuote({
          ...quoteInput,
          material: v.material,
          materialId: v.material.toLowerCase(),
          widthMm: v.width_mm,
          heightMm: v.height_mm,
          shape: v.shape,
          flags: { isTransparent, hasWhiteInk }
          //designCount: allowMultiDesign ? quoteInput.designCount : 1, // for design count to be separated from total quantity
        });
        const sizeNice = v.shape === "Round"
          ? `${v.width_mm}mm diameter`
          : `${v.width_mm}mm (W) X ${v.height_mm}mm (H)`;
        return {
          ...q,
          material: q.materialLabel || v.material,
          shape: v.shape,
          individualCutCost: q.quantity * 0.20,
          dieCutCost:        q.quantity * 0.25,
          shapeNice: v.shape === "Round" ? "Circular" : v.shape,
          sizeNice,
        };
      });
      // a grand total so each variant does not stands alone
      const grandTotal = quotes.reduce((acc, q) => acc + (Number(q.total) || 0), 0);
      // --- Detect courier request and compute fee ---
      const courierRequested = /courier|delivery|send\s+to|ship\s+to/i.test(text);
      let courierPrice = 0;
      let courierPostal = "";
      let addr = null;

      if (courierRequested) {
        addr = await findLatestAddr(text);  // already in llm.js
        courierPostal = addr.AddressPostalCode || "";
        courierPrice = getCourierFeeByPostal(courierPostal);
      }

      const courierTotal = courierRequested ? grandTotal + courierPrice : grandTotal;

      const tpl = await loadTemplate("STICKER_QUOTE");
      const body = await composeAnswer(text, [
          ...await retrieveSiteSnippets(text, 6),
          ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
        ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`));
      const bodyHtml = body.replace(/\n/g, "<br>");
      html = tpl({
        customerName: quoteInput.customerName,
        quotes,                 // ← NOW multiple lines will render
        total: grandTotal,     // a grand total so each variant does not stands alone
        body: bodyHtml,
        staffName,
        courier: courierRequested,
        courierPrice,
        courierPostal,
        courierTotal,
        body: bodyHtml,
        ...(addr || {}), // spread JSON fields directly for {{AddressName}}, {{customerName}}, etc.
        ask,  // pass awareness to template
        usage_purpose: fields.usage_purpose || null,     // pass awareness to template
        distribution_mode: fields.distribution_mode || null,    // pass awareness to template
      });
    } else {
      const tpl = await loadTemplate("STICKER_NO_QUOTE");
      const fields = (await extractQuoteFields(text || "")) || {};
      const rawCut = String(fields.cut_type || fields.cutType || fields.finish || fields.cut || "")
        .trim().toLowerCase();
      const quoteInput = {
        ...toQuoteInput(fields),
        individualCut: rawCut === "individual-cut",
        dieCut:        rawCut === "die-cut",
      };
      // need to filter out defined fields
      const body = await composeAnswer(text, [
        ...await retrieveSiteSnippets(text, 6),
        ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
      ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`));
      html = tpl({ 
        customerName: quoteInput.customerName, 
        body, 
        staffName });
    }
  } else if (p === "namecards") {
    if ( i === "quote_payment") {
      // just for name
      const fields = (await extractQuoteFields(text || "")) || {};
      const quoteInput = {...toQuoteInput(fields) };
      // (reuse your namecards branch here...)
      const { quantities, sides } = parseBizCardFields(text);
      const hasBack = Number(sides) === 2;
      const boxes = quantities.map(qty => ({ quantity: qty }));
      const q = calcBizCardQuote({ boxes, hasBack });
      const tpl = await loadTemplate("NAMECARDS");
      const box0 = q.boxes?.[0] || {}; // single-box mapping for existing template
      // after you have `boxes`, to display the [300,300,100] part
      const packCounts = boxes
        .map(b => b.quantity)
        .reduce((acc, q) => (acc[q] = (acc[q] || 0) + 1, acc), {});
      const namesSummary = Object.entries(packCounts)
        .sort((a, b) => Number(b[0]) - Number(a[0]))  // optional order by pack
        .map(([q, c]) => `${c} name${c > 1 ? "s" : ""} x ${q} pcs`)
        .join(" + ");

      let grandTotal = Number(q.total || 0);
      // --- Detect courier request and compute fee ---
      const courierRequested = /courier|delivery|send\s+to|ship\s+to/i.test(text);
      let courierPrice = 0;
      let courierPostal = "";
      let addr = null;

      if (courierRequested) {
        addr = await findLatestAddr(text);  // already in llm.js
        courierPostal = addr.AddressPostalCode || "";
        courierPrice = getCourierFeeByPostal(courierPostal);
      }

      grandTotal = courierRequested ? grandTotal + courierPrice : grandTotal;
      html = tpl({ 
        customerName: quoteInput.customerName || customerName,
        BL: boxes.length,
        namesSummary, // to display namecards [300,300,100]
        DS: hasBack ? "Double Sided Full Colour" : "Single Sided Full Colour",
        quantity: box0.quantityCharged,
        front: q.subtotalFronts,
        back: hasBack ? q.sharedBack?.backIncrement : undefined,
        total: grandTotal,                     // keep numeric; format in HBS with {{money total}}
        courier: courierRequested,
        courierPrice,
        courierPostal,
        body: await composeAnswer(text, [
          ...await retrieveSiteSnippets(text, 6),
          ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
        ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`)), 
        staffName,
        ...(addr || {}),
      });
    } else {
      // just for customer name
      const fields = (await extractQuoteFields(text || "")) || {};
      const quoteInput = {...toQuoteInput(fields) };
      // (reuse your namecards branch here...)
      const { quantities, sides } = parseBizCardFields(text);
      const hasBack = Number(sides) === 2;
      const boxes = quantities.map(qty => ({ quantity: qty }));
      const q = calcBizCardQuote({ boxes, hasBack });
      const tpl = await loadTemplate("NAMECARDS_QUOTE");
      const box0 = q.boxes?.[0] || {};
      // after you have `boxes`, to display the [300,300,100] part
      const packCounts = boxes
        .map(b => b.quantity)
        .reduce((acc, q) => (acc[q] = (acc[q] || 0) + 1, acc), {});
      const namesSummary = Object.entries(packCounts)
        .sort((a, b) => Number(b[0]) - Number(a[0]))  // optional order by pack
        .map(([q, c]) => `${c} name${c > 1 ? "s" : ""} x ${q} pcs`)
        .join(" + ");

      html = tpl({ 
        customerName: quoteInput.customerName || customerName,
        BL: boxes.length,
        namesSummary, // to display namecards [300,300,100]
        DS: hasBack ? "Double Sided Full Colour" : "Single Sided Full Colour",
        quantity: box0.quantityCharged,
        front: q.subtotalFronts,
        back: hasBack ? q.sharedBack?.backIncrement : undefined,
        total: q.total,                     // numeric
        body: await composeAnswer(text, [
          ...await retrieveSiteSnippets(text, 6),
          ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
        ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`)), 
        staffName,
      });
    }
  } else if (p == "both") { //varients for stickers not done, so only can compute 1 type of sticker(eg, cannot do mirrorkote and synthetic)
    if ( i === "quote_payment") {
      // (reuse sticker branch here...)
      const fields = (await extractQuoteFields(text || "")) || {};
      const rawCut = String(fields.cut_type || fields.cutType || fields.finish || fields.cut || "")
        .trim().toLowerCase();
      const quoteInput = {
        ...toQuoteInput(fields),
        individualCut: rawCut === "individual-cut",
        dieCut:        rawCut === "die-cut",
      };
      const exprFromText = extractQtyExprFromText(text);
      if (exprFromText) quoteInput.quantityExpr = exprFromText;
      const quote = calcQuote(quoteInput);
      
      // (reuse namecards branch here...)
      const { quantities, sides } = parseBizCardFields(text);
      const hasBack = Number(sides) === 2;
      const boxes = quantities.map(qty => ({ quantity: qty }));
      const q = calcBizCardQuote({ boxes, hasBack });
      // after you have `boxes`, to display the [300,300,100] part
      const packCounts = boxes
        .map(b => b.quantity)
        .reduce((acc, q) => (acc[q] = (acc[q] || 0) + 1, acc), {});
      const namesSummary = Object.entries(packCounts)
        .sort((a, b) => Number(b[0]) - Number(a[0]))  // optional order by pack
        .map(([q, c]) => `${c} name${c > 1 ? "s" : ""} x ${q} pcs`)
        .join(" + ");

      const grandTotal = Number(quote.total || 0);
      // --- Detect courier request and compute fee ---
      const courierRequested = /courier|delivery|send\s+to|ship\s+to/i.test(text);
      let courierPrice = 0;
      let courierPostal = "";
      let addr = null;

      if (courierRequested) {
        addr = await findLatestAddr(text);  // already in llm.js
        courierPostal = addr.AddressPostalCode || "";
        courierPrice = getCourierFeeByPostal(courierPostal);
      }

      const courierTotal = courierRequested ? grandTotal + courierPrice : grandTotal;

      const tpl = await loadTemplate("BOTH_PAYMENT");
      const box0 = q.boxes?.[0] || {};
      html = tpl({
        customerName: quoteInput.customerName,

        // --- STICKERS (unchanged above this section) ---
        quotes: [{
          ...quote,
          material: quote.materialLabel || quoteInput.material,
          shape: quoteInput.shape,
          shapeNice: quoteInput.shape === "Round" ? "Circular" : quoteInput.shape,
          sizeNice: quoteInput.shape === "Round"
            ? `${quoteInput.widthMm}mm diameter`
            : `${quoteInput.widthMm}mm (W) X ${quoteInput.heightMm}mm (H)`,
        }],
        total: Number(quote.total || 0),
        courier: courierRequested,
        courierPrice,
        courierPostal,
        courierTotal,

        // --- NAMECARDS mapping using new calculator ---
        body: await composeAnswer(text, [
          ...await retrieveSiteSnippets(text, 6),
          ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
        ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`)),
        BL: boxes.length,
        namesSummary, // to display namecards [300,300,100]
        DS: hasBack ? "Double Sided Full Colour" : "Single Sided Full Colour",
        cardQuantity: box0.quantityCharged,
        front: q.subtotalFronts,
        back: hasBack ? q.sharedBack?.backIncrement : undefined,
        totalC: q.total,                  // numeric; format in HBS with {{money totalC}}
        staffName,
        ...(addr || {}),
      });
    } else {
      // (reuse sticker branch here...)
      const fields = (await extractQuoteFields(text || "")) || {};
      const rawCut = String(fields.cut_type || fields.cutType || fields.finish || fields.cut || "")
        .trim().toLowerCase();
      const quoteInput = {
        ...toQuoteInput(fields),
        individualCut: rawCut === "individual-cut",
        dieCut:        rawCut === "die-cut",
      };
      const exprFromText = extractQtyExprFromText(text);
      if (exprFromText) quoteInput.quantityExpr = exprFromText;
      const quote = calcQuote(quoteInput);
      
      // (reuse namecards branch here...)
      const { quantities, sides } = parseBizCardFields(text);
      const hasBack = Number(sides) === 2;
      const boxes = quantities.map(qty => ({ quantity: qty }));
      const q = calcBizCardQuote({ boxes, hasBack });
      // after you have `boxes`, to display the [300,300,100] part
      const packCounts = boxes
        .map(b => b.quantity)
        .reduce((acc, q) => (acc[q] = (acc[q] || 0) + 1, acc), {});
      const namesSummary = Object.entries(packCounts)
        .sort((a, b) => Number(b[0]) - Number(a[0]))  // optional order by pack
        .map(([q, c]) => `${c} name${c > 1 ? "s" : ""} x ${q} pcs`)
        .join(" + ");

      const grandTotal = Number(quote.total || 0);
      // --- Detect courier request and compute fee ---
      const courierRequested = /courier|delivery|send\s+to|ship\s+to/i.test(text);
      let courierPrice = 0;
      let courierPostal = "";
      let addr = null;

      if (courierRequested) {
        addr = await findLatestAddr(text);  // already in llm.js
        courierPostal = addr.AddressPostalCode || "";
        courierPrice = getCourierFeeByPostal(courierPostal);
      }

      const courierTotal = courierRequested ? grandTotal + courierPrice : grandTotal;

      const tpl = await loadTemplate("BOTH_PAYMENT");
      const box0 = q.boxes?.[0] || {};
      html = tpl({
        customerName: quoteInput.customerName,

        // --- STICKERS (unchanged above this section) ---
        quotes: [{
          ...quote,
          material: quote.materialLabel || quoteInput.material,
          shape: quoteInput.shape,
          shapeNice: quoteInput.shape === "Round" ? "Circular" : quoteInput.shape,
          sizeNice: quoteInput.shape === "Round"
            ? `${quoteInput.widthMm}mm diameter`
            : `${quoteInput.widthMm}mm (W) X ${quoteInput.heightMm}mm (H)`,
        }],
        total: Number(quote.total || 0),
        courier: courierRequested,
        courierPrice,
        courierPostal,
        courierTotal,

        // --- NAMECARDS mapping using new calculator ---
        body: await composeAnswer(text, [
          ...await retrieveSiteSnippets(text, 6),
          ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
        ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`)),
        BL: boxes.length,
        namesSummary, // to display namecards [300,300,100]
        DS: hasBack ? "Double Sided Full Colour" : "Single Sided Full Colour",
        cardQuantity: box0.quantityCharged,
        front: q.subtotalFronts,
        back: hasBack ? q.sharedBack?.backIncrement : undefined,
        totalC: q.total,                  // numeric; format in HBS with {{money totalC}}
        staffName,
        ...(addr || {}),
      });
    }
  } else {
    const tpl = await loadTemplate("GENERAL_OTHERS");
    const body = await composeAnswer(text, [
      ...await retrieveSiteSnippets(text, 6),
      ...((await retrieveSimilar(text, 3)) || []).map(n => n.body?.slice(0, 280)).filter(Boolean)
    ].map(s => typeof s === "string" ? s : `${s.title}\n${s.snippet} (src: ${s.url})`));
    html = tpl({ customerName, body, staffName});
  }
  return { html };
}

import express from "express";
import cors from "cors";
import multer from "multer";

const app = express();
app.use(cors());
app.use(express.json());

// memory storage so req.file.buffer is available
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// optional health check
app.get("/health", (_req, res) => res.status(200).send("OK"));

app.post("/api/compose", upload.single("file"), async (req, res) => {
  console.log("---- /api/compose ----");
  console.log("has file?", !!req.file, "mimetype:", req.file?.mimetype);

  try {
    const intent       = req.body.intent;
    const customerName = req.body.customerName || "";
    const uiTextBox    = (req.body.text || "").trim(); //ui text input for quotes part
    let pdfText        = "";   //only pdf text
    const staffName    = req.body.staffName;
    const styleNotes   = req.body.styleNotes; //ui text input for general part

    // parse PDF only if we truly have a buffer
    if (req.file?.buffer && req.file.mimetype === "application/pdf") {
      try {
        const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
        const parsed = await pdfParse(req.file.buffer);
        // console.log("PDF text preview:", (parsed.text || "").slice(0, 300));
        pdfText = (parsed.text || "").trim();
      } catch (e) {
        console.error("PDF parse failed:", e);
      }
    } else {
      console.warn("No PDF buffer found (skipping parse)");
    }

    // Label sections so LLM knows which part is which
    let mergedText = "";

    if (uiTextBox) {
      mergedText += [
        "TEXTBOX INPUT (Priority: High)",
        "-------------------------------",
        uiTextBox,
        ""
      ].join("\n");
    }
    if (pdfText) {
      mergedText += [
        "EXTRACTED PDF TEXT (Priority: Low)",
        "-----------------------------------",
        pdfText
      ].join("\n");
    }

    mergedText = mergedText.trim();
    //console.log("MERGED TEXT:"+mergedText);

    // classify product if not provided
    let product = req.body.product;
    if (!product) {
      const cls = await classifyProductAndIntent(mergedText);
      product = cls.product;
    }

    //console.log("⏳ composing from text", mergedText, "product=", product, "intent=", intent);
    const { html } = await composeFromText({ text:mergedText, intent, product, customerName, staffName, styleNotes });
    console.log("✅ sending html");
    return res.status(200).json({ html });

  } catch (err) {
    console.error("❌ compose error:", err);
    // ALWAYS send something renderable to the UI
    return res.status(200).json({
      html: `<p style="color:#b00020"><strong>Server error:</strong> ${String(err?.message || err)}</p>`
    });
  }
});