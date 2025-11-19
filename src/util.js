//util.js file is ment for pure nomalization and parsing helpers
export function normShape(s = '') {
  const v = String(s).toLowerCase().trim();

  // LLM enums & synonyms → calculator/display labels
  if (v === 'round' || /circular|circle/.test(v)) return 'Round';
  if (v === 'square-rounded' || /square.*rounded/.test(v)) return 'Square (Rounded corners)';
  if (v === 'rect-rounded'   || /rectangle.*rounded/.test(v)) return 'Rectangle (Rounded corners)';
  if (v === 'square-straight' || v === 'square') return 'Square';
  if (v === 'rect-straight'   || v.startsWith('rect')) return 'Rectangle';
  if (v === 'oval' || v.includes('oval')) return 'Oval';

  // catch-all
  return 'Custom-shape';
}
export function normMaterial(s='') {
  const v = s.toLowerCase();
  if (!v || v === 'default') return 'mirrorkote';
  if (v.includes('synthetic') || v === 'pp') return 'synthetic';
  if (v.includes('pvc')) return 'white pvc';
  return v; // assume already supported by calcQuote
}
export function normQtyExpr(q='') {
  // '100pcs' -> '100', keep '3x50' as-is
  const m1 = q.match(/(\d{1,5})\s*(pcs|pieces?)?/i);
  if (m1) return m1[1];
  const m2 = q.match(/(\d{1,4})\s*[x×*]\s*(\d{1,4})/i);
  if (m2) return `${m2[1]}x${m2[2]}`;
  return '1';
}
export function toQuoteInput(order) {
  return {
    customerName: order.customer_name,
    widthMm: Number(order.width_mm) || 0,
    heightMm: Number(order.height_mm) || 0,
    shape: normShape(order.shape || 'Rectangle'),
    material: normMaterial(order.material || 'mirrorkote'),
    quantityExpr: normQtyExpr(order.quantity_expr || '1'),
    designCount: Number(order.design_count) || 1,
  };
}
