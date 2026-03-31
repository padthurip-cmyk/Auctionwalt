// netlify/functions/generate-bill.js

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: corsHeaders() });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders() });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500, headers: corsHeaders() });

  try {
    const { billNumber, items, buyer, seller, billStatus, totalAmount, taxRate, date } = await req.json();

    const subtotal = items.reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
    const taxAmount = +(subtotal * (taxRate || 0.13)).toFixed(2);
    const grandTotal = +(subtotal + taxAmount).toFixed(2);

    const sys = `Generate a professional Bill of Sale as clean, self-contained HTML for printing. Return ONLY HTML (no markdown backticks). Use inline CSS. A4/Letter layout. Include:
- Dark header bar with seller business name, address, phone, email, HST#
- "BILL OF SALE" title prominently
- Bill number, date, payment status (PAID in green or PAYMENT DUE in red, bold)
- Buyer section: name, email, phone
- Itemized table with columns: #, Item Description, Lot #, Qty, Unit Price, Amount
- Subtotal, HST (13%), Grand Total rows
- If status is "due": show "PAYMENT DUE" watermark-style text, due terms
- If status is "paid": show "PAID" stamp
- Footer: "All sales are final. Items sold as-is." and seller signature line
- Font: Arial, sans-serif. Professional, clean, printable.`;

    const prompt = `Create a Bill of Sale document:
Bill #: ${billNumber}
Date: ${date || new Date().toISOString()}
Status: ${billStatus || 'paid'}

Seller: ${JSON.stringify(seller)}

Buyer: ${JSON.stringify(buyer)}

Items:
${items.map((item, i) => `${i + 1}. ${item.title} (Lot #${item.lot_number || 'N/A'}) - Qty: ${item.quantity || 1} - Price: $${parseFloat(item.price).toFixed(2)}`).join('\n')}

Subtotal: $${subtotal.toFixed(2)}
HST (13%): $${taxAmount.toFixed(2)}
Grand Total: $${grandTotal.toFixed(2)}

Return ONLY the complete HTML.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, system: sys, messages: [{ role: 'user', content: prompt }] }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      let errMsg;
      try { errMsg = JSON.parse(responseText).error?.message || `API error ${response.status}`; } catch { errMsg = `API error ${response.status}`; }
      return new Response(JSON.stringify({ error: errMsg }), { status: response.status, headers: corsHeaders() });
    }

    const data = JSON.parse(responseText);
    const html = data.content?.map(b => b.text || '').join('').replace(/```html|```/g, '').trim() || '';

    return new Response(JSON.stringify({ html, subtotal, taxAmount, grandTotal }), { status: 200, headers: corsHeaders() });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to generate bill' }), { status: 500, headers: corsHeaders() });
  }
};

function corsHeaders() {
  return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}

export const config = { path: '/api/generate-bill' };
