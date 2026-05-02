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

    // 3 modes: "full" | "items_only" | "summary"
    const isItemsOnly = mode === 'items_only';
    const isSummary = mode === 'summary';

    let systemPrompt;

    if (isSummary) {
      systemPrompt = `You are reading the SUMMARY/TOTALS page of an auction invoice. Extract ALL financial totals. Return ONLY valid JSON:
{"summary":{"lot_total":0,"premium_rate":0.16,"premium_total":0,"handling_fee_total":0,"tax_total":0,"grand_total":0,"total_quantity":0}}
LOOK FOR these exact labels (they may vary slightly):
- "Total Extended Price" or "Lot Total" or "Subtotal" → lot_total
- "Buyer's Premium" with a % → premium_rate (as decimal: 16%=0.16, 20%=0.20) AND premium_total (dollar amount)
- "Handling Fee" or "Handling" → handling_fee_total 
- "Tax" or "HST" or "GST" or "Tax1 Default" → tax_total
- "Invoice Total" or "Grand Total" or "Total Due" or "Remaining Invoice Balance" → grand_total
- "Total Quantity" → total_quantity
READ THE EXACT DOLLAR AMOUNTS. Do not calculate. If a line says "16% Buyer's Premium: 36.00" then premium_rate=0.16 and premium_total=36.00.
If this page has BOTH items AND a summary section, still extract the summary totals.`;

    } else if (isItemsOnly) {
      systemPrompt = `Extract EVERY item/lot from this auction invoice page (page ${pageNumber || '?'}). Return ONLY valid JSON:
{"items":[{"lot_number":"","title":"Short title","description":"","quantity":1,"hammer_price":0.00,"handling_fee":0.00}]}
RULES:
- Extract EVERY SINGLE item. Count them carefully. Do NOT skip any.
- lot_number = the lot/item number (e.g. 1368, 1372, etc.)
- hammer_price = the EXTENDED PRICE shown (e.g. "1 x 5.50   5.50" → hammer_price is 5.50)
- If there is a "Handling Fee -   1.00" line below an item, set handling_fee=1.00 for that item
- Include items that continue from a previous page (partial descriptions at top)
- If this page has summary totals at the bottom (Total Extended Price, Premium, etc), still extract all items above it
- Return {"items":[]} ONLY if there are truly zero items on this page`;

    } else {
      systemPrompt = `Extract the invoice header AND ALL items from this auction invoice page. Return ONLY valid JSON:
{"invoice":{"date":"YYYY-MM-DD","auction_house":"","invoice_number":"","event_description":"","payment_method":"","payment_status":"Unpaid","pickup_location":"","buyer_premium_rate":0.00,"tax_rate":0.13},"items":[{"lot_number":"","title":"Short title","description":"","quantity":1,"hammer_price":0.00,"handling_fee":0.00}]}
RULES:
- auction_house = the company name (e.g. "Ruito Trading Inc.")
- invoice_number = Invoice # shown
- date = invoice date in YYYY-MM-DD format
- pickup_location = any address/location shown
- payment_status = "Paid" or "Unpaid" (look for PAID/UNPAID stamps)
- buyer_premium_rate = if mentioned (e.g. "16% Buyer's Premium" = 0.16), otherwise 0
- Extract EVERY item on this page. hammer_price = the extended price amount
- "Handling Fee - 1.00" below items = handling_fee for that item`;
    }

    const content = [];
    if (fileType?.includes('pdf')) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
    } else if (fileType?.startsWith('image/')) {
      content.push({ type: 'image', source: { type: 'base64', media_type: fileType, data: base64 } });
    } else {
      content.push({ type: 'text', text: base64 });
    }

    const userMsg = isSummary
      ? 'Extract the invoice totals/summary from this page. Return ONLY JSON.'
      : isItemsOnly
        ? 'Extract ALL items and their handling fees from this page. Return ONLY JSON.'
        : 'Extract invoice header and ALL items with handling fees. Return ONLY JSON.';
    content.push({ type: 'text', text: userMsg });

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
        return new Response(JSON.stringify({ error: 'Response was truncated. Try uploading fewer pages at once.' }), { status: 500, headers: corsHeaders() });
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
