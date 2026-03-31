// All API calls go through Netlify Functions (server-side proxy)
// Your ANTHROPIC_API_KEY is safe on the server

export async function parseInvoiceAI(base64, fileType) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s max wait

  try {
    const r = await fetch('/api/parse-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, fileType }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await r.json();

    if (!r.ok || data.error) {
      throw new Error(data.error || `Server error ${r.status}`);
    }

    return data;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Invoice took too long to process. Try a clearer photo or smaller PDF.');
    }
    throw err;
  }
}

export async function generateReceiptAI(soldItem, bizInfo, customerInfo) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const r = await fetch('/api/generate-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ soldItem, bizInfo, customerInfo }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await r.json();

    if (!r.ok || data.error) {
      throw new Error(data.error || `Server error ${r.status}`);
    }

    return data.html;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Receipt generation timed out. Try again.');
    }
    throw err;
  }
}

export function sendEmailFallback(to, subject, body) {
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(url, '_blank');
}
