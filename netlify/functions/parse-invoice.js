// netlify/functions/parse-invoice.js

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: corsHeaders() });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders() });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set.' }), { status: 500, headers: corsHeaders() });

  try {
    const body = await req.json();
    const { base64, fileType, mode, pageNumber } = body;
    if (!base64) return new Response(JSON.stringify({ error: 'No file data' }), { status: 400, headers: corsHeaders() });

    const isItemsOnly = mode === 'items_only';

    const systemPrompt = isItemsOnly
      ? `You extract ALL items/lots from this auction invoice page (page ${pageNumber || '?'} of multi-page). Return ONLY valid JSON (no markdown, no backticks):
{"items":[{"lot_number":"","title":"Short item title","description":"Full description","quantity":1,"hammer_price":0.00,"premium_amount":0.00,"tax_amount":0.00,"other_fees":0.00,"other_fees_desc":"","total_cost":0.00}]}
CRITICAL RULES:
- Extract EVERY item/lot. Do NOT skip any.
- hammer_price = the bid/hammer/lot amount ONLY
- premium_amount = buyer's premium for THIS item (read from invoice, do NOT guess)
- tax_amount = tax for THIS item (read from invoice, do NOT guess)
- other_fees = any additional charges for this item (handling, processing, storage, holding, shipping, etc). Sum all extra fees into this one number.
- other_fees_desc = short label of what the extra fees are (e.g. "handling, storage")
- total_cost = the ACTUAL total shown on invoice for this item. If the invoice shows a per-item total, USE THAT. If not, sum: hammer + premium + tax + other_fees
- Read the REAL numbers from the invoice. Do NOT calculate or estimate — copy the exact amounts shown.`
      : `You extract ALL data from auction invoices. Return ONLY valid JSON (no markdown, no backticks):
{"invoice":{"date":"YYYY-MM-DD","auction_house":"","invoice_number":"","event_description":"","payment_method":"Cash/Credit/Visa/Online/Flywire/Unknown","payment_status":"Paid/Unpaid/Due","pickup_location":"","buyer_premium_rate":0.00,"tax_rate":0.00,"lot_total":0,"premium_total":0,"tax_total":0,"other_fees_total":0,"other_fees_labels":"","grand_total":0},"items":[{"lot_number":"","title":"Short title","description":"Full description","quantity":1,"hammer_price":0.00,"premium_amount":0.00,"tax_amount":0.00,"other_fees":0.00,"other_fees_desc":"","total_cost":0.00}]}
CRITICAL RULES:
- Extract EVERY single item/lot on the invoice. Do NOT skip any.
- For EACH item read the ACTUAL amounts from the invoice:
  * hammer_price = bid/hammer/lot amount
  * premium_amount = buyer's premium for this item
  * tax_amount = tax (HST/GST/PST/VAT) for this item
  * other_fees = ANY additional per-item charges: handling, processing, storage, holding, insurance, shipping, admin fees, etc. Sum them all.
  * other_fees_desc = label what those fees are
  * total_cost = the ACTUAL per-item total from the invoice. If shown, use the invoice's number. If not shown, sum all the above.
- For the invoice header:
  * buyer_premium_rate = the premium percentage as decimal (e.g. 20% = 0.20). Read from invoice, don't guess.
  * tax_rate = tax percentage as decimal (e.g. 13% = 0.13)
  * lot_total = sum of all hammer prices
  * premium_total = total premium charges
  * tax_total = total tax
  * other_fees_total = total of all handling/processing/storage/other fees
  * other_fees_labels = comma-separated names of extra fee types found
  * grand_total = the ACTUAL invoice grand total as shown on the document
- IMPORTANT: Read REAL numbers from the document. Do NOT calculate/estimate. The invoice total must match what's printed.`;

    const content = [];
    if (fileType?.includes('pdf')) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
    } else if (fileType?.startsWith('image/')) {
      content.push({ type: 'image', source: { type: 'base64', media_type: fileType, data: base64 } });
    } else {
      content.push({ type: 'text', text: base64 });
    }
    content.push({ type: 'text', text: isItemsOnly ? 'Extract ALL items/lots from this page. Return ONLY JSON.' : 'Extract all invoice data and every item. Return ONLY JSON.' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 16384, system: systemPrompt, messages: [{ role: 'user', content }] }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      let errMsg;
      try { errMsg = JSON.parse(responseText).error?.message || `API error ${response.status}`; } catch { errMsg = `API error ${response.status}`; }
      return new Response(JSON.stringify({ error: errMsg }), { status: response.status, headers: corsHeaders() });
    }

    const data = JSON.parse(responseText);
    const text = data.content?.map(b => b.text || '').join('') || '';
    const clean = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      parsed = recoverJSON(clean);
      if (!parsed) {
        return new Response(JSON.stringify({ error: 'Response was too large and got truncated. Upload each page as a separate image.' }), { status: 500, headers: corsHeaders() });
      }
    }

    return new Response(JSON.stringify(parsed), { status: 200, headers: corsHeaders() });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to parse invoice' }), { status: 500, headers: corsHeaders() });
  }
};

function recoverJSON(text) {
  try { return JSON.parse(text); } catch {}
  try {
    const arrStart = text.indexOf('[', text.indexOf('"items"'));
    if (arrStart === -1) return null;
    let lastClose = -1, depth = 0, inStr = false, esc = false;
    for (let i = arrStart; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) lastClose = i; }
    }
    if (lastClose > arrStart) {
      const attempt = text.substring(0, lastClose + 1) + ']}';
      try { return JSON.parse(attempt); } catch {}
    }
  } catch {}
  return null;
}

function corsHeaders() {
  return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}

export const config = { path: '/api/parse-invoice' };
