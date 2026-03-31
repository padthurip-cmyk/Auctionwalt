export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const fmt = (v) => { const n = parseFloat(v); return isNaN(n) ? '$0.00' : `$${n.toFixed(2)}`; };
export const fmtDate = (d) => { if (!d) return ''; try { return new Date(d).toLocaleDateString('en-CA'); } catch { return d; } };
export const fmtTs = (d) => { if (!d) return ''; try { return new Date(d).toLocaleString('en-CA', { dateStyle: 'short', timeStyle: 'short' }); } catch { return d; } };

export const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result.split(',')[1]);
  r.onerror = () => reject(new Error('File read failed'));
  r.readAsDataURL(file);
});

export const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('File read failed'));
  r.readAsDataURL(file);
});

export function openWhatsApp(phone, text) {
  const encoded = encodeURIComponent(text);
  const clean = phone ? phone.replace(/\D/g, '') : '';
  window.open(clean ? `https://wa.me/${clean}?text=${encoded}` : `https://wa.me/?text=${encoded}`, '_blank');
}

export function openSMS(phone, text) {
  const encoded = encodeURIComponent(text);
  window.open(`sms:${phone || ''}?body=${encoded}`, '_blank');
}

export function printHTML(html) {
  const w = window.open('', '_blank', 'width=800,height=900');
  w.document.write(`<!DOCTYPE html><html><head><title>Receipt</title><style>@media print{body{margin:0}}body{font-family:Arial,sans-serif;}</style></head><body>${html}</body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

export function buildReceiptText(si, biz) {
  return `Receipt #${si.receipt_number}\nFrom: ${biz.name}\n${biz.address}\n${biz.phone}\n\nItem: ${si.title}\nAmount: ${fmt(si.sold_price)}\nDate: ${fmtTs(si.sold_at)}\n\nThank you for your purchase!`;
}
