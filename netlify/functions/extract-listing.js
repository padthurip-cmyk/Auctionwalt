// netlify/functions/extract-listing.js
// Fetches Open Graph meta tags from a marketplace URL (Facebook, Kijiji, eBay, etc.)

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors() });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: cors() });

  try {
    const { url } = await req.json();
    if (!url) return new Response(JSON.stringify({ error: 'No URL' }), { status: 400, headers: cors() });

    // Validate URL
    let parsed;
    try { parsed = new URL(url); } catch { return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400, headers: cors() }); }

    // Fetch with browser-like headers
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Could not fetch listing (${response.status}). Try pasting details manually.` }), { status: 200, headers: cors() });
    }

    const html = await response.text();

    // Extract Open Graph and meta tags
    const result = {
      title: extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title') || extractTag(html, 'title'),
      description: extractMeta(html, 'og:description') || extractMeta(html, 'twitter:description') || extractMeta(html, 'description'),
      image: extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image'),
      price: extractMeta(html, 'product:price:amount') || extractMeta(html, 'og:price:amount') || extractPrice(html),
      currency: extractMeta(html, 'product:price:currency') || extractMeta(html, 'og:price:currency') || 'CAD',
      siteName: extractMeta(html, 'og:site_name') || parsed.hostname,
      url: extractMeta(html, 'og:url') || url,
    };

    // Try to extract additional images from og:image tags
    const images = extractAllMeta(html, 'og:image');
    if (images.length > 0) result.images = images;

    // Clean up
    if (result.title) result.title = decodeEntities(result.title);
    if (result.description) result.description = decodeEntities(result.description).slice(0, 500);
    if (result.price) result.price = parseFloat(result.price.replace(/[^0-9.]/g, '')) || null;

    const hasData = result.title || result.description || result.image || result.price;
    if (!hasData) {
      return new Response(JSON.stringify({ error: 'Could not extract listing data. The page may require login. Try pasting details manually.', partial: result }), { status: 200, headers: cors() });
    }

    return new Response(JSON.stringify(result), { status: 200, headers: cors() });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Extraction failed' }), { status: 200, headers: cors() });
  }
};

function extractMeta(html, property) {
  // Match both property="" and name="" attributes
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${escRe(property)}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${escRe(property)}["']`, 'i'),
    new RegExp(`<meta[^>]*name=["']${escRe(property)}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${escRe(property)}["']`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function extractAllMeta(html, property) {
  const results = [];
  const regex = new RegExp(`<meta[^>]*(?:property|name)=["']${escRe(property)}["'][^>]*content=["']([^"']*)["']`, 'gi');
  let m;
  while ((m = regex.exec(html)) !== null) { if (m[1]) results.push(m[1].trim()); }
  // Also reverse order
  const regex2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${escRe(property)}["']`, 'gi');
  while ((m = regex2.exec(html)) !== null) { if (m[1] && !results.includes(m[1].trim())) results.push(m[1].trim()); }
  return results;
}

function extractTag(html, tag) {
  const m = html.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function extractPrice(html) {
  // Try common price patterns in the HTML
  const patterns = [
    /\$\s*([\d,]+\.?\d{0,2})/,
    /CAD\s*([\d,]+\.?\d{0,2})/i,
    /price["':]\s*["']?\$?([\d,]+\.?\d{0,2})/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) return m[1].replace(/,/g, '');
  }
  return null;
}

function escRe(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function decodeEntities(str) { return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'"); }

function cors() {
  return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}

export const config = { path: '/api/extract-listing' };
