const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

export async function parseInvoiceAI(base64, fileType) {
  const sys = `You extract ALL items from auction invoices. Return ONLY valid JSON (no markdown, no backticks, no preamble):
{"invoice":{"date":"YYYY-MM-DD","auction_house":"","invoice_number":"","event_description":"","payment_method":"Cash/Credit/Visa/Online/Flywire/Unknown","payment_status":"Paid/Unpaid","pickup_location":"","buyer_premium_rate":0.17,"tax_rate":0.13,"lot_total":0,"premium_total":0,"tax_total":0,"grand_total":0},"items":[{"lot_number":"","title":"Short title","description":"Full description","quantity":1,"hammer_price":0.00}]}
Rules: Extract every single lot. buyer_premium_rate as decimal. tax_rate typically 0.13 for HST. Be precise with all numbers.`;

  const content = [];
  if (fileType?.includes('pdf')) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
  } else if (fileType?.startsWith('image/')) {
    content.push({ type: 'image', source: { type: 'base64', media_type: fileType, data: base64 } });
  } else {
    content.push({ type: 'text', text: base64 });
  }
  content.push({ type: 'text', text: 'Extract all invoice data and items from this document. Return ONLY the JSON object.' });

  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: sys, messages: [{ role: 'user', content }] }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'API error');
  const text = d.content?.map(b => b.text || '').join('') || '';
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

export async function generateReceiptAI(soldItem, bizInfo, customerInfo) {
  const sys = `Generate a professional sale receipt as clean, self-contained HTML. Return ONLY the HTML. Use inline CSS. Style for printing A4/Letter. Include: dark header bar with business name, receipt number, date, customer details, itemized table with description/qty/price, subtotal, tax (13% HST), total, payment info, thank you footer. Font: Arial, sans-serif. Clean and professional.`;

  const prompt = `Create a sale receipt:
Business: ${JSON.stringify(bizInfo)}
Customer: ${JSON.stringify(customerInfo)}
Sale: ${JSON.stringify({
    title: soldItem.title,
    description: soldItem.description,
    lot_number: soldItem.lot_number,
    quantity: soldItem.quantity || 1,
    price: soldItem.sold_price,
    date: soldItem.sold_at,
    receipt_number: soldItem.receipt_number,
    platform: soldItem.sold_platform
  })}
Tax: 13% HST
Return ONLY the complete HTML.`;

  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, system: sys, messages: [{ role: 'user', content: prompt }] }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'API error');
  return d.content?.map(b => b.text || '').join('').replace(/```html|```/g, '').trim() || '';
}

export async function sendGmail(to, subject, htmlBody) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: `Send an email to ${to} with subject "${subject}". Body:\n\n${htmlBody}` }],
      mcp_servers: [{ type: 'url', url: 'https://gmail.mcp.claude.com/mcp', name: 'gmail' }],
    }),
  });
  return await r.json();
}
