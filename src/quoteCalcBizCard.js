// quoteCalcBizCard.js
const PRICE_TABLE = {
  100: { SS: 23.0, DS: 46.0 },   // DS != 2×SS (so back = 13) (23+23) (but this is special case??)
  200: { SS: 41.0, DS: 82.0 },   // DS = 2×SS (so back = 41)
  300: { SS: 56.0, DS: 112.0 },
  400: { SS: 68.0, DS: 136.0 },
  500: { SS: 78.0, DS: 156.0 },
  600: { SS: 93.6, DS: 187.2 },
  700: { SS: 109.2, DS: 218.4 },
  800: { SS: 124.8, DS: 249.6 },
  900: { SS: 140.4, DS: 280.8 },
  1000:{ SS: 156.0, DS: 312.0 },
  1100:{ SS: 171.6, DS: 343.2 },
  1200:{ SS: 187.2, DS: 374.4 },
  1300:{ SS: 202.8, DS: 405.6 },
  1400:{ SS: 218.4, DS: 436.8 },
  1500:{ SS: 234.0, DS: 468.8 },
  1600:{ SS: 249.6, DS: 499.2 },
  1700:{ SS: 265.2, DS: 530.4 },
  1800:{ SS: 280.8, DS: 561.6 },
  1900:{ SS: 296.4, DS: 592.8 },
  2000:{ SS: 312.0, DS: 624.0 }
};

// const PACKS = Object.keys(PRICE_TABLE).map(n => Number(n)).sort((a,b)=>a-b);
// const cents = n => Math.round(Number(n) * 100);
// const dollars = c => +(c/100).toFixed(2);

// function roundUpToPack(qty){ for (const p of PACKS) if (qty <= p) return p; return PACKS.at(-1); }

// /**
//  * @param {{quantity:number, sides:1|2, overrides?: {front?: number, back?: number}}} input
//  * If overrides.front/back provided (SGD), they replace the computed values.
//  */
// export function calcBizCardQuote(input){
//   if (!input || !Number.isFinite(input.quantity) || input.quantity <= 0)
//     throw new Error('quantity must be a positive number');

//   const sides = Number(input.sides) === 2 ? 2 : 1;
//   const pack = roundUpToPack(input.quantity);
//   const row = PRICE_TABLE[pack];
//   if (!row) throw new Error('No price row for pack ' + pack);

//   // Derive default front/back from table
//   const defaultFront = row.SS;           // front = single-sided price
//   const defaultBack  = row.DS - row.SS;  // incremental back cost (works for both special & 2×SS tiers)

//   // Allow optional manual overrides
//   const front = input?.overrides?.front ?? defaultFront;
//   const back  = input?.overrides?.back  ?? defaultBack;

//   const frontC = cents(front);
//   const backC  = cents(back);
//   const totalC = sides === 1 ? frontC : (frontC + backC);
//   let grandTotalC = totalC
//   // <$35 surcharge rule
//   if (grandTotalC < 3500) grandTotalC += 1000;

//   return {
//     product: 'Business Cards',
//     size: '85×50mm (straight corners)',
//     material: '300gsm Smooth/Rough Matte',
//     sides,
//     quantityRequested: input.quantity,
//     quantityCharged: pack,
//     // unit price = total / pack
//     unitPrice: dollars(totalC / pack),
//     // expose front/back and total in SGD
//     front: dollars(frontC),
//     back: dollars(backC),
//     total: dollars(grandTotalC),
//     notes: input.quantity === pack
//       ? `Standard pack of ${pack}pcs.`
//       : `Rounded up to nearest standard pack (${pack}pcs).`
//   };
// }

/**
 * Quote multiple boxes; optional ONE shared back artwork.
 * Each box pays its own single-sided (front) pack price.
 * If hasBack=true, the group pays ONE back increment at the combined pack: DS(total) − SS(total).
 * A single $10 surcharge is applied ONCE at the end IFF final total < $35.00.
 *
 * @param {Object} input
 * @param {Array<{ quantity: number, overrides?: { front?: number } }>} input.boxes
 * @param {boolean} [input.hasBack=false]
 */
export function calcBizCardQuote(input) {
  if (!input || !Array.isArray(input.boxes) || input.boxes.length === 0) {
    throw new Error("boxes[] required");
  }
  const hasBack = !!input.hasBack;

  // Helpers (reuse your table + rounding)
  const PACKS = Object.keys(PRICE_TABLE).map(n => Number(n)).sort((a,b)=>a-b);
  const cents   = n => Math.round(Number(n) * 100);
  const dollars = c => +(c / 100).toFixed(2);
  const roundUpToPack = (qty) => { for (const p of PACKS) if (qty <= p) return p; return PACKS.at(-1); };

  const boxLines = [];
  let sumFrontC = 0;
  let combinedQty = 0;

  // Fronts: sum SS at each box's own pack
  for (const [i, box] of input.boxes.entries()) {
    if (!box || !Number.isFinite(box.quantity) || box.quantity <= 0) {
      throw new Error(`boxes[${i}] quantity must be a positive number`);
    }
    const pack = roundUpToPack(box.quantity);
    const row  = PRICE_TABLE[pack];
    if (!row) throw new Error(`No price row for pack ${pack}`);

    const defaultFront = row.SS;                        // single-sided price for this pack
    const front = box?.overrides?.front ?? defaultFront;

    const frontC = cents(front);                        // NOTE: no per-box surcharge any more

    boxLines.push({
      pack,
      quantityRequested: box.quantity,
      quantityCharged: pack,
      front: dollars(frontC),
    });

    sumFrontC += frontC;
    combinedQty += box.quantity;
  }

  // Back: ONE shared increment at combined pack (if hasBack)
  let backC = 0;
  let sharedBack = null;

  if (hasBack) {
    const combinedPack = roundUpToPack(combinedQty);
    const combinedRow  = PRICE_TABLE[combinedPack];
    if (!combinedRow) throw new Error(`No price row for combined pack ${combinedPack}`);

    const backIncrement = combinedRow.DS - combinedRow.SS;   // DS−SS at combined pack
    backC = cents(backIncrement);

    sharedBack = {
      combinedQuantityRequested: combinedQty,
      combinedPack,
      backIncrement: dollars(backC),
      note: `Shared back charged once at ${combinedPack} pack (DS−SS).`,
    };
  }

  // Total BEFORE surcharge
  let totalC = sumFrontC + backC;

  // === Single surcharge rule ===
  // Apply ONCE at the END IFF final total < 3500 cents ($35.00)
  if (totalC < 3500) {
    totalC += 1000; // +$10 once
  }

  return {
    product: hasBack
      ? "Business Cards (multiple fronts + shared back)"
      : "Business Cards (multiple fronts, no back)",
    boxes: boxLines,
    sharedBack,                          // null when hasBack=false
    subtotalFronts: dollars(sumFrontC),
    total: dollars(totalC),              // numeric dollars
    policy: {
      surchargeApplied: totalC < 4500 && (sumFrontC + backC) < 3500, // true if it triggered
      surchargeNote: "Single $10 minimum-charge surcharge applied once at the end when total < $35.00.",
    }
  };
}
