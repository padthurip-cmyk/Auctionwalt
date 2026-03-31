// All API calls go through Netlify Functions (server-side proxy)
// Your ANTHROPIC_API_KEY lives safely in Netlify environment variables
// The browser NEVER sees your API key

export async function parseInvoiceAI(base64, fileType) {
  const r = await fetch('/api/parse-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, fileType }),
  });

  const data = await r.json();

  if (!r.ok || data.error) {
    throw new Error(data.error || `Server error ${r.status}`);
  }

  return data;
}

export async function generateReceiptAI(soldItem, bizInfo, customerInfo) {
  const r = await fetch('/api/generate-receipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soldItem, bizInfo, customerInfo }),
  });

  const data = await r.json();

  if (!r.ok || data.error) {
    throw new Error(data.error || `Server error ${r.status}`);
  }

  return data.html;
}

// Email: uses mailto: link as a universal fallback that works on every device
export function sendEmailFallback(to, subject, body) {
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(url, '_blank');
}
