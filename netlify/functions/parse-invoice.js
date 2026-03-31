// netlify/functions/parse-invoice.js
// Proxies invoice parsing to Claude API with server-side API key

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: corsHeaders() });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders() });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured. Go to Netlify → Site settings → Environment variables → Add ANTHROPIC_API_KEY' }),
      { status: 500, headers: corsHeaders() }
    );
  }

  try {
    const body = await req.json();
    const { base64, fileType } = body;

    if (!base64) {
      return new Response(JSON.stringify({ error: 'No file data provided' }), { status: 400, headers: corsHeaders() });
    }

    const systemPrompt = `You extract ALL items from auction invoices. Return ONLY valid JSON (no markdown, no backticks, no preamble):
{"invoice":{"date":"YYYY-MM-DD","auction_house":"","invoice_number":"","event_description":"","payment_method":"Cash/Credit/Visa/Online/Flywire/Unknown","payment_status":"Paid/Unpaid","pickup_location":"","buyer_premium_rate":0.17,"tax_rate":0.13,"lot_total":0,"premium_total":0,"tax_total":0,"grand_total":0},"items":[{"lot_number":"","title":"Short title","description":"Full description","quantity":1,"hammer_price":0.00}]}
Rules: Extract every single lot/item. buyer_premium_rate as decimal (e.g. 0.17 for 17%). tax_rate typically 0.13 for HST. Be precise with all numbers. If payment shows "Paid in Full" or receipt, status is "Paid".`;

    const content = [];
    if (fileType?.includes('pdf')) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
    } else if (fileType?.startsWith('image/')) {
      content.push({ type: 'image', source: { type: 'base64', media_type: fileType, data: base64 } });
    } else {
      content.push({ type: 'text', text: base64 });
    }
    content.push({ type: 'text', text: 'Extract all invoice data and items. Return ONLY the JSON object.' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: errData.error?.message || `API returned ${response.status}` }),
        { status: response.status, headers: corsHeaders() }
      );
    }

    const data = await response.json();
    const text = data.content?.map(b => b.text || '').join('') || '';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    return new Response(JSON.stringify(parsed), { status: 200, headers: corsHeaders() });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Failed to parse invoice' }),
      { status: 500, headers: corsHeaders() }
    );
  }
};

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export const config = {
  path: '/api/parse-invoice',
};
