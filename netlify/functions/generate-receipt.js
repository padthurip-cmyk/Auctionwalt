// netlify/functions/generate-receipt.js

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
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured in Netlify environment variables' }),
      { status: 500, headers: corsHeaders() }
    );
  }

  try {
    const { soldItem, bizInfo, customerInfo } = await req.json();

    const systemPrompt = `Generate a professional sale receipt as clean, self-contained HTML. Return ONLY HTML (no markdown backticks). Use inline CSS. Style for printing A4/Letter. Include: dark header bar with business name/address/phone, receipt number, date, customer name/email/phone, itemized table with description/qty/unit price/total, subtotal, HST (13%), grand total, payment method, and a thank you footer. Font: Arial, sans-serif. Clean, professional, printable.`;

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
Tax: 13% HST. Return ONLY the complete HTML.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
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
    const html = data.content?.map(b => b.text || '').join('').replace(/```html|```/g, '').trim() || '';

    return new Response(JSON.stringify({ html }), { status: 200, headers: corsHeaders() });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Failed to generate receipt' }),
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
  path: '/api/generate-receipt',
};
