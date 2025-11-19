// src/quoteCalc.js
// map our canonical materialId -> the string used by a4/a3 price tables
const SHEET_NAME_BY_ID = {
  // --- Base (already in your file) ---
  mirrorkote: "Mirrorkote",
  synthetic_pp: "Synthetic",
  synthetic: "Synthetic",
  pvc: "PVC (White-base)",

  // UI “no selection” fallbacks
  none: "Synthetic",
  default: "Synthetic",
  paper: "Synthetic",
  sticker: "Synthetic",
  vinyl: "PVC (White-base)",
  "silver waterproof": "Silver PVC",
  "waterproof silver": "Silver PVC",
  "none (default)": "Synthetic",
  "unknown" : "Synthetic",
  "transparent material": "Synthetic",

  // ---------- Synthetic (≈ 230) ----------
  // Screenshot “Syn Tier” papers (map to Synthetic price bucket)
  washi: "Synthetic",
  "washi paper": "Synthetic",

  "fluorescent paper": "Synthetic",
  "fluorescent paper (green)": "Synthetic",
  "fluorescent paper (orange)": "Synthetic",
  "fluorescent paper (red)": "Synthetic",

  "gold speckled paper": "Synthetic",
  "gold speckled (vintage)": "Synthetic",
  "gold speckled (white)": "Synthetic",
  "gold speckled (red)": "Synthetic",

  "kraft": "Synthetic",
  "kraft paper": "Synthetic",

  "sand gold paper": "Synthetic",

  "textured paper": "Synthetic",
  "textured paper (laid - cool white)": "Synthetic",
  "textured paper (laid - warm white)": "Synthetic",
  "textured paper (rough - grey)": "Synthetic",
  "textured paper (rough - yellow)": "Synthetic",

  // “Gold Paper (Kiss-cut without Printing only)” still price-bucketed like Syn for A4
  "gold paper": "Synthetic",
  "gold paper (kiss-cut without printing only)": "Synthetic",

  // ---------- PVC (≈ 380) ----------
  "pvc (white)": "PVC (White-base)",
  "pvc (white-base)":"PVC (White-base)",
  "white pvc":"PVC (White-base)",
  "pvc (transparent)": "PVC (White-base)",
  "pvc [white & transparent]": "PVC (White-base)",
  // PVC (transparent)
  "pvc (transparent)": "PVC (Transparent)",
  "pvc(transparent)":  "PVC (Transparent)",    // no-space variant
  // Synthetic
  "synthetic (transparent)": "Synthetic (Transparent)",
  "synthetic(transparent)":  "Synthetic (Transparent)",
  "transparent material":    "Synthetic (Transparent)",

  // ---------- Removable Synthetic (≈ 380) ----------
  "frosted synthetic": "Removable Synthetic",           // +Removable
  "frosted synthetic (+removable)": "Removable Synthetic",
  "synthetic [white] (+removable)": "Removable Synthetic",
  "removable synthetic": "Removable Synthetic",

  // ---------- Removable PVC (≈ 530) ----------
  "pvc [white & transparent] (+removable)": "Removable PVC (White-base)",
  "removable pvc": "Removable PVC (White-base)",
  "removable pvc (white-base)": "Removable PVC (White-base)",
  "removable pvc (transparent)": "Removable PVC (Transparent)",

  // ---------- Silver / Metallized ----------
  // Synthetic metalized (≈ 380)
  "silver foil synthetic": "Silver Synthetic",
  "silver synthetic": "Silver Synthetic",

  // PVC metalized (≈ 530)
  "silver foil pvc": "Silver PVC",
  "silver pvc": "Silver PVC",
  "silver chrome pvc": "Silver PVC",                    // (DISCONTINUED) → map to same price bucket
  "gold foil pvc": "Silver PVC",                        // (DISCONTINUED) often same metallized PVC rate

  // ---------- Hologram ----------
  // Synthetic (≈ 380)
  "holographic synthetic": "Hologram Synthetic",
  "hologram synthetic": "Hologram Synthetic",

  // PVC (≈ 350 in your a4OneSheetPrice)
  "holographic pvc": "Hologram PVC",
  "hologram pvc": "Hologram PVC",

  // ---------- Specialty / Decal-ish ----------
  // Anti-slip rough PVC isn’t explicitly in your price table function.
  // If you have a separate bucket for Decal/Anti-slip, swap this mapping accordingly.
  "anti-slip rough pvc": "PVC (White-base)",           // placeholder; adjust if you keep a Decal tier

  // Reverse-print variant (keep price bucket by substrate; flags handled elsewhere)
  "pvc [white & trans] (+remove) (+reverse)": "Removable PVC (White-base)",

  // ---------- A3-only (leave mapped so code won’t break; gate by size elsewhere) ----------
  "temp tattoo": "Synthetic", // Only available in A3; enforce size rule elsewhere
};

const BLEED = 3;

// A4 defaults
const BASE = {
  pFeeCents: 780,
  cutPerStrokeCents: 13,
  fullW: 287,
  fullH: 200,
  subsequentProcessingCents: 300
};

// For “round/rounded/oval” on A4
const ROUNDY = {
  pFeeCents: 980,
  cutPerStrokeCents: 19,
  fullW: 277,
  fullH: 190
};

// For custom-shape on A4
const CUSTOM = {
  pFeeCents: 1200,
  cutPerStrokeCents: 23,
  fullW: 277,
  fullH: 190
};

// A3 defaults (material pricing differs; cut/pfee depends on shape)
const A3DEFAULT = {
  pFeeCents: 780,
  cutPerStrokeCents: 26,
  fullW: 277,
  fullH: 392
};
const A3ROUNDY = { pFeeCents: 980, cutPerStrokeCents: 38 };
const A3CUSTOM  = { pFeeCents: 1200, cutPerStrokeCents: 46 };

// Per-piece finishing fees (in cents)
const PER_PIECE_FEES = {
  individualCutCents: 20, // $0.20 per sticker
  dieCutCents: 25         // $0.25 per sticker
};

// ---------- helpers ----------
const centsToDollars = (c) => +(c / 100).toFixed(2);

function parseQuantityExpr(expr) {
  //Input: "7x100+500"
  //Output: the numbers your calculator needs: qty (total pieces)
  // designs (design count: each plain number = 1 design; each N*xM contributes N designs)
  // extraCount = designs - 1
  // display (pretty version for the template)

  // mirror legacy behaviour:
  // - remove spaces
  // - x/X -> *
  // - extra fee counter:
  //     +1 for every '+'
  //     and for any term like "N*..." add N to the counter
  // let s = expr.replace(/\s+/g, "").replace(/[xX]/g, "*");
  // const display = s.replace(/\*/g, " X ");
  // let qty = 0;
  // try { qty = Number(eval(s)); } catch { qty = 0; } // eslint-disable-line no-eval

  // let extra = 0;
  // // + occurrences
  // extra += (s.match(/\+/g) || []).length;
  // // add left multiplicands
  // for (const term of s.split("+")) {
  //   const m = term.match(/^(\d+)\s*[*]/);
  //   if (m) extra += Number(m[1]);
  // }
  // return { qty, extraCount: extra, display };

  //update for 500 + 7x100
  let s = String(expr || "").replace(/\s+/g, "").replace(/[xX]/g, "*");
  const display = s.replace(/\*/g, " X ");

  // total pieces
  let qty = 0;
  for (const term of s.split("+")) {
    const [a, b] = term.split("*").map(Number);
    qty += b ? a * b : a;
  }

  // designs = sum over '+' segments:
  //   - if no '*': +1
  //   - if 'N*...': +N
  let designs = 0;
  for (const term of s.split("+")) {
    const m = term.match(/^(\d+)\*(\d+)$/);
    designs += m ? Number(m[1]) : 1;
  }
  const extraCount = Math.max(0, designs - 1);

  return { qty, designs, extraCount, display };
}

function a4OneSheetPrice(material) {
  // If your original function had different A4 rates, update below.
  switch (material) {
    case "Mirrorkote": return 110;
    case "Synthetic":
    case "Synthetic (Transparent)": return 230;
    case "PVC (White-base)":
    case "PVC (Transparent)": return 380;
    // case "Window Sticker (White-base)": return 1200;

    case "Removable Synthetic": return 380;
    case "Removable PVC (White-base)":
    case "Removable PVC (Transparent)": return 530;
    case "Silver Synthetic": return 380;
    case "Silver PVC": return 530;

    case "Hologram Synthetic": return 380;
    case "Hologram PVC": return 350;
    // case "Floor Sticker": return 1200;
    default: return 110;
  }
}

function a3OneSheetPrice(material) {
  switch (material) {
    case "Mirrorkote": return 220;
    case "Synthetic":
    case "Synthetic (Transparent)": return 460;
    case "PVC (White-base)":
    case "PVC (Transparent)": return 760;
    case "Window Sticker (White-base)": return 1460;

    case "Removable Synthetic": return 760;
    case "Removable PVC (White-base)":
    case "Removable PVC (Transparent)": return 1060;
    case "Silver Synthetic": return 760;
    case "Silver PVC": return 1060;

    case "Hologram Synthetic": return 760;
    case "Hologram PVC": return 1060;
    case "Floor Sticker": return 1460;
    default: return 220;
  }
}

function chooseCutParams(shape) {
  if (
    shape === "Round" ||
    shape === "Rectangle (Rounded corners)" ||
    shape === "Square (Rounded corners)" ||
    shape === "Oval"
  ) return ROUNDY;
  if (shape === "Custom-shape") return CUSTOM;
  return BASE;
}

function strokesAndUnitPrice({
  w, h, fullW, fullH, pFeeCents, cutPerStrokeCents, oneSheetPriceCents
}) {
  // Orientation 1
  let w1 = w, h1 = h;
  if (pFeeCents !== BASE.pFeeCents) { w1 += BLEED; h1 += BLEED; }
  const wStrokes1 = Math.floor(fullW / w1);
  const hStrokes1 = Math.floor(fullH / h1);
  const strokes1 = (wStrokes1 + hStrokes1);
  const strokesCost1 = (strokes1 + 2) * cutPerStrokeCents;
  const pcsPerSheet1 = wStrokes1 * hStrokes1;
  const unit1 = pcsPerSheet1 ? (oneSheetPriceCents + strokesCost1) / pcsPerSheet1 : Infinity;

  // Orientation 2 (swap the w and h)
  let w2 = h, h2 = w;
  if (pFeeCents !== BASE.pFeeCents) { w2 += BLEED; h2 += BLEED; }
  const wStrokes2 = Math.floor(fullW / w2);
  const hStrokes2 = Math.floor(fullH / h2);
  const strokes2 = (wStrokes2 + hStrokes2);
  const strokesCost2 = (strokes2 + 2) * cutPerStrokeCents;
  const pcsPerSheet2 = wStrokes2 * hStrokes2;
  const unit2 = pcsPerSheet2 ? (oneSheetPriceCents + strokesCost2) / pcsPerSheet2 : Infinity;

  const unitCents = Math.min(unit1, unit2);
  const chosen = (unit1 <= unit2)
    ? { pcsPerSheet: pcsPerSheet1, strokesUsed: strokes1 }
    : { pcsPerSheet: pcsPerSheet2, strokesUsed: strokes2 };

  return {
    unitCents: isFinite(unitCents) ? unitCents : Infinity,
    pcsPerSheet: chosen.pcsPerSheet,
    strokesUsed: chosen.strokesUsed
  };
}

export function calcQuote(input) {
  //const { qty } = parseQuantityExpr(input.quantityExpr);
  //const extraCount = Math.max(0, input.designCount - 1 );
  const { qty, designs, extraCount, display } = parseQuantityExpr(input.quantityExpr);
  if (!qty || qty <= 0) throw new Error("Invalid quantity expression");

  // total pieces of qty(eg.55) * design count(eg. 3): 55 x 3
  // const effectiveQty = qty * (extraCount+1);
  // ⬇️ Use qty directly; do NOT multiply by designs
  const effectiveQty = qty;
  if (!qty || qty <= 0) throw new Error("Invalid quantity expression");

  // size hard-codes, enforce a minimum pricing size = 20
  let w = Math.max(20, input.widthMm);
  let h = Math.max(20, input.heightMm);
  if (w === 90) w = 89;
  if (h === 90) h = 89;

  // A4 attempt
  const roundy = chooseCutParams(input.shape);

  const materialId = input.materialId || input.material; // backward-compat
  const sheetName = SHEET_NAME_BY_ID[materialId];
  if (!sheetName) {
    throw new Error(`Unsupported material for sheet pricing: ${materialId} (add a mapping/rate)`);
  }
  const oneSheetA4 = a4OneSheetPrice(sheetName);

  const paramsA4 = {
    w, h,
    fullW: roundy.fullW ?? BASE.fullW,
    fullH: roundy.fullH ?? BASE.fullH,
    pFeeCents: roundy.pFeeCents ?? BASE.pFeeCents,
    cutPerStrokeCents: roundy.cutPerStrokeCents ?? BASE.cutPerStrokeCents,
    oneSheetPriceCents: oneSheetA4
  };
  const a4 = strokesAndUnitPrice(paramsA4);

  let paperSize = "A4";
  let unitCents = a4.unitCents;

  // If A4 infeasible → A3 path (matches legacy)
  if (!isFinite(unitCents)) {
    paperSize = "A3";
    let a3Cut = { ...A3DEFAULT };
    if (
      input.shape === "Round" ||
      input.shape === "Rectangle (Rounded corners)" ||
      input.shape === "Square (Rounded corners)" ||
      input.shape === "Oval"
    ) a3Cut = { ...A3DEFAULT, ...A3ROUNDY };
    else if (input.shape === "Custom-shape") a3Cut = { ...A3DEFAULT, ...A3CUSTOM };

    const oneSheetA3 = a3OneSheetPrice(sheetName);

    const a3 = strokesAndUnitPrice({
      w, h,
      fullW: A3DEFAULT.fullW,
      fullH: A3DEFAULT.fullH,
      pFeeCents: a3Cut.pFeeCents,
      cutPerStrokeCents: a3Cut.cutPerStrokeCents,
      oneSheetPriceCents: oneSheetA3
    });
    unitCents = a3.unitCents;
  }

  // processing fee + subsequent
  const useA3 = paperSize === "A3";
  const pFeeCents =
    useA3
      ? (
          input.shape === "Custom-shape" ? A3CUSTOM.pFeeCents
        : (["Round","Rectangle (Rounded corners)","Square (Rounded corners)","Oval"].includes(input.shape) ? A3ROUNDY.pFeeCents : A3DEFAULT.pFeeCents)
        )
      : (
          input.shape === "Custom-shape" ? CUSTOM.pFeeCents
        : (["Round","Rectangle (Rounded corners)","Square (Rounded corners)","Oval"].includes(input.shape) ? ROUNDY.pFeeCents : BASE.pFeeCents)
        );

  const subsequentCents = BASE.subsequentProcessingCents;
  const processingFee = centsToDollars(pFeeCents);
  const subsequentProcessing = centsToDollars(subsequentCents);
  
  //check if got individual/die cut
  // check if got individual/die cut (support several keys/strings)
  const wantIndividualCut =
    input.individualCut === true ||
    input.cutType === "individual-cut" ||
    input.finish === "individual-cut" ||
    input.cut === "individual-cut";

  const wantDieCut =
    input.dieCut === true ||
    input.cutType === "die-cut" ||
    input.finish === "die-cut" ||
    input.cut === "die-cut"
  // Per-piece extras in cents and dollars
  const perPieceExtrasCents =
    (wantIndividualCut ? PER_PIECE_FEES.individualCutCents : 0) +
    (wantDieCut ? PER_PIECE_FEES.dieCutCents : 0);

  // unit price to dollars with legacy 1dp rounding then format to cents → 2dp
  const unitDollarsExact = unitCents / 100;
  const perPieceExtras = perPieceExtrasCents / 100;
  // const unit2dpRounded = Number(unitDollarsExact.toFixed(2));
  const unit3dpRounded = Number(unitDollarsExact.toFixed(3)); //cost of 1 sticker
  // Final unit price = base unit + per-piece extras
  const unitPriceFinal = +(unit3dpRounded + perPieceExtras).toFixed(3); // cost of 1 sticker + 1 die/indi cut(0.25)
  const line = unitPriceFinal * effectiveQty; //line is price of total sticker only no processing fees

  // calculations excluding the die cut individual cut for display
  const unitPriceFinalNoCutIncluded = +(unit3dpRounded).toFixed(3); //unit price no die cut or individual cut included
  const lineNoCutIncluded = unitPriceFinalNoCutIncluded * effectiveQty; // pice of total sticker only no processing fees
  let totalnoCutIncluded = processingFee + (extraCount * subsequentProcessing) + lineNoCutIncluded; //total no cut included

  // --- White Ink underlay (show for transparent stocks; tweak if you want it always)
  const isTransparent = /transparent/i.test(String(sheetName || ""));
  let whiteInk = null;
  let totalWhiteInk = 0;

  if (isTransparent) {
    // Half the no-cut per-piece price
    const unitHalf = +(unit3dpRounded / 2).toFixed(3);       // e.g. 0.051
    const lineWhiteInk = +(unitHalf * effectiveQty).toFixed(3);
    totalWhiteInk = +(processingFee + lineWhiteInk).toFixed(3); // SAME processing fee; NO <$35 surcharge here

    whiteInk = {
      apply: true,
      processingFee: +processingFee.toFixed(3),
      unitHalf,     // per-piece for white ink (half of original, no cut)
      qty: effectiveQty,
      lineWhiteInk,         // unitHalf × qty
      totalWhiteInk         // processingFee + line   (no <$35)
    };
  }

  let total = processingFee + (extraCount * subsequentProcessing) + line + totalWhiteInk;
  // <$35 surcharge rule
  let surchargeApplied = false;
  if (totalnoCutIncluded < 35.0) {
    totalnoCutIncluded += 10;
    total += 10;
    surchargeApplied = true;
  }

  return {
    materialLabel: sheetName,
    paperSize,
    kissCutOn: paperSize,
    unitPrice: unitPriceFinal,
    processingFee: +processingFee.toFixed(2),
    subsequentProcessing: +subsequentProcessing.toFixed(2),
    extraProcessingCount: extraCount,
    quantity: effectiveQty, // total quantity
    designCount: extraCount + 1,
    perDesignQty: qty,
    total: +total.toFixed(2),
    // NEW for display in HBS:
    totalQty: qty,              // e.g., 1200
    designCount: designs,       // e.g., 8
    quantityDisplay: display,   // e.g., "500 + 7 X 100"
    breakdown: {
      oneSheetPrice: centsToDollars(useA3 ? a3OneSheetPrice(sheetName) : a4OneSheetPrice(sheetName)),
      cutPerStroke: centsToDollars(
        useA3
          ? (["Custom-shape"].includes(input.shape) ? A3CUSTOM.cutPerStrokeCents
             : (["Round","Rectangle (Rounded corners)","Square (Rounded corners)","Oval"].includes(input.shape) ? A3ROUNDY.cutPerStrokeCents : A3DEFAULT.cutPerStrokeCents))
          : (["Custom-shape"].includes(input.shape) ? CUSTOM.cutPerStrokeCents
             : (["Round","Rectangle (Rounded corners)","Square (Rounded corners)","Oval"].includes(input.shape) ? ROUNDY.cutPerStrokeCents : BASE.cutPerStrokeCents))
      ),
      strokesUsed: 0, // optional: expose from strokesAndUnitPrice if needed
      pcsPerSheet: 0,
      pFeeRaw: pFeeCents,
      perPieceExtras: +(perPieceExtras.toFixed(2)),
      individualCut: wantIndividualCut,
      dieCut: wantDieCut,
      unitPriceFinalNoCutIncluded: unitPriceFinalNoCutIncluded,
      totalnoCutIncluded: totalnoCutIncluded,
      surchargeApplied,
      whiteInk,
    }
  };
}