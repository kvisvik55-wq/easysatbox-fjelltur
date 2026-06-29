// Bilde-proxy: henter et Firebase Storage-bilde server-side og leverer det
// på samme domene, slik at <canvas> ikke blir "tainted" (CORS) ved redigering.
exports.handler = async (event) => {
  const url = event.queryStringParameters && event.queryStringParameters.url;
  if (!url) return { statusCode: 400, body: 'mangler url' };

  let u;
  try { u = new URL(url); } catch (e) { return { statusCode: 400, body: 'ugyldig url' }; }

  // Tillat kun Firebase/Google Storage — ingen åpen proxy.
  const okHost = /(^|\.)firebasestorage\.googleapis\.com$/.test(u.hostname)
              || /(^|\.)storage\.googleapis\.com$/.test(u.hostname)
              || /(^|\.)googleapis\.com$/.test(u.hostname);
  if (!okHost) return { statusCode: 403, body: 'kun firebase storage tillatt' };

  try {
    const r = await fetch(url);
    if (!r.ok) return { statusCode: r.status, body: 'henting feilet' };
    const ct = r.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//.test(ct)) return { statusCode: 415, body: 'ikke et bilde' };
    const buf = Buffer.from(await r.arrayBuffer());
    return {
      statusCode: 200,
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
      },
      body: buf.toString('base64'),
      isBase64Encoded: true
    };
  } catch (e) {
    return { statusCode: 500, body: 'proxy-feil' };
  }
};
