// netlify/functions/claude.js
// Claude-proxy for EasySatBox-appene. Holder API-nøkkelen på serveren.
// Frontend snakker ALDRI direkte med api.anthropic.com.
// Nøkkel: Netlify → Site settings → Environment variables → ANTHROPIC_API_KEY
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ feil: 'Bruk POST' }) };
  }
  try {
    const { messages, max_tokens = 1000, system } = JSON.parse(event.body || '{}');

    if (!process.env.ANTHROPIC_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ feil: 'ANTHROPIC_API_KEY mangler' }) };
    }
    if (!Array.isArray(messages)) {
      return { statusCode: 400, body: JSON.stringify({ feil: 'messages må være en array' }) };
    }

    const body = { model: 'claude-sonnet-4-6', max_tokens, messages };
    if (system) body.system = system;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    return { statusCode: r.status, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ feil: 'Proxy-feil', detalj: String(err) }) };
  }
};
