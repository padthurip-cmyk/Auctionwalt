// All API calls go through Netlify Functions

export async function parseInvoiceAI(base64, fileType) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const r = await fetch('/api/parse-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64, fileType }), signal: controller.signal });
    clearTimeout(timeout); const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || `Server error ${r.status}`);
    return data;
  } catch (err) { clearTimeout(timeout); if (err.name === 'AbortError') throw new Error('Invoice took too long. Try uploading pages separately.'); throw err; }
}

export async function parseInvoicePageAI(base64, fileType, mode, pageNumber) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const r = await fetch('/api/parse-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64, fileType, mode, pageNumber }), signal: controller.signal });
    clearTimeout(timeout); const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || `Server error ${r.status}`);
    return data;
  } catch (err) { clearTimeout(timeout); if (err.name === 'AbortError') throw new Error(`Page ${pageNumber} timed out. Try again.`); throw err; }
}

export async function generateReceiptAI(soldItem, bizInfo, customerInfo) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const r = await fetch('/api/generate-receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ soldItem, bizInfo, customerInfo }), signal: controller.signal });
    clearTimeout(timeout); const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || `Server error ${r.status}`);
    return data.html;
  } catch (err) { clearTimeout(timeout); if (err.name === 'AbortError') throw new Error('Timed out. Try again.'); throw err; }
}

export async function generateBillAI({ billNumber, items, buyer, seller, billStatus, taxRate, date }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);
  try {
    const r = await fetch('/api/generate-bill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ billNumber, items, buyer, seller, billStatus, taxRate, date }), signal: controller.signal });
    clearTimeout(timeout); const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || `Server error ${r.status}`);
    return data;
  } catch (err) { clearTimeout(timeout); if (err.name === 'AbortError') throw new Error('Bill generation timed out.'); throw err; }
}

export async function extractListing(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch('/api/extract-listing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal: controller.signal });
    clearTimeout(timeout); const data = await r.json();
    if (data.error && !data.title && !data.image && !data.price) throw new Error(data.error);
    return data;
  } catch (err) { clearTimeout(timeout); if (err.name === 'AbortError') throw new Error('Extraction timed out.'); throw err; }
}

export function sendEmailFallback(to, subject, body) {
  window.open(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
}
