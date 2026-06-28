// netlify/functions/claude.js
// Claude-proxy for EasySatBox-appene + verktøy for sanntids vær (MET/Yr).
// Nøkkelen holdes på serveren. Frontend snakker ALDRI direkte med api.anthropic.com.
// MET og Nominatim KREVER en identifiserende User-Agent — derfor må vær hentes server-side.
const UA = 'EasySatBox-Fjelltur/1.0 (https://easysatbox-fjelltur.netlify.app; kvisvik55@gmail.com)';

async function callAnthropic(body) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, data: await r.json() };
}

function compass(deg) {
  const dirs = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

async function geocodeKartverket(place) {
  // Kartverkets stedsnavn-API: gratis, offisielt, ingen nøkkel, ideelt for norske steder.
  const url = 'https://api.kartverket.no/stedsnavn/v1/navn?sok=' + encodeURIComponent(place) +
              '&utkoordsys=4326&treffPerSide=1&side=1&fuzzy=true';
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const j = await r.json();
  const n = j && j.navn && j.navn[0];
  const pt = n && n.representasjonspunkt;
  if (!pt) return null;
  const lat = pt.nord, lon = pt['øst'];
  if (lat == null || lon == null) return null;
  const navn = n.skrivemåte || n.stedsnavn || place;
  const komm = (n.kommuner && n.kommuner[0] && n.kommuner[0].kommunenavn) ? ', ' + n.kommuner[0].kommunenavn : '';
  return { lat: +lat, lon: +lon, name: navn + komm };
}

async function geocodeNominatim(place) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(place);
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const j = await r.json();
  if (Array.isArray(j) && j[0]) return { lat: +j[0].lat, lon: +j[0].lon, name: j[0].display_name };
  return null;
}

async function geocode(place) {
  // Prøv Kartverket først (norske steder), fall tilbake til Nominatim (resten av verden).
  try { const k = await geocodeKartverket(place); if (k) return k; } catch (e) {}
  try { const n = await geocodeNominatim(place); if (n) return n; } catch (e) {}
  return null;
}

const PLACE_CAT = {
  dagligvare: 'nwr["shop"~"supermarket|convenience|grocery|general"]',
  mat: 'nwr["shop"~"supermarket|convenience|grocery|general"]',
  groceries: 'nwr["shop"~"supermarket|convenience|grocery|general"]',
  food: 'nwr["shop"~"supermarket|convenience|grocery|general"]',
  bensin: 'nwr["amenity"="fuel"]',
  drivstoff: 'nwr["amenity"="fuel"]',
  fuel: 'nwr["amenity"="fuel"]',
  apotek: 'nwr["amenity"="pharmacy"]',
  pharmacy: 'nwr["amenity"="pharmacy"]',
  overnatting: 'nwr["tourism"~"hotel|hostel|guest_house|chalet|camp_site|alpine_hut|wilderness_hut"]',
  lodging: 'nwr["tourism"~"hotel|hostel|guest_house|chalet|camp_site|alpine_hut|wilderness_hut"]',
  hytte: 'nwr["tourism"~"alpine_hut|wilderness_hut|chalet"]',
  spisested: 'nwr["amenity"~"restaurant|cafe|fast_food|pub|bar"]',
  restaurant: 'nwr["amenity"~"restaurant|cafe|fast_food|pub|bar"]'
};

async function findPlaces(input) {
  let { place, lat, lon, category, radius } = input || {};
  let name = place || '';
  if ((lat == null || lon == null) && place) {
    const g = await geocode(place);
    if (!g) return 'Fant ikke stedet «' + place + '».';
    lat = g.lat; lon = g.lon; name = g.name;
  }
  if (lat == null || lon == null) return 'Mangler posisjon (lat/lon eller stedsnavn).';
  const cat = (category || 'dagligvare').toLowerCase();
  const filter = PLACE_CAT[cat] || PLACE_CAT.dagligvare;
  const rad = Math.min(Math.max(radius || 5000, 500), 25000);
  const q = '[out:json][timeout:15];(' + filter + '(around:' + rad + ',' + (+lat).toFixed(4) + ',' + (+lon).toFixed(4) + '););out center 20;';
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: 'data=' + encodeURIComponent(q),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) return 'Stedstjenesten svarte ikke (' + r.status + ').';
    const j = await r.json();
    const items = (j.elements || [])
      .map(e => {
        const t = e.tags || {};
        const nm = t.name || t.brand || t.operator;
        if (!nm) return null;
        const kind = t.shop || t.amenity || t.tourism || '';
        const extra = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
        return '- ' + nm + (kind ? ' (' + kind + ')' : '') + (extra ? ', ' + extra : '');
      })
      .filter(Boolean);
    // fjern duplikater på navn
    const seen = new Set(), uniq = [];
    for (const it of items) { if (!seen.has(it)) { seen.add(it); uniq.push(it); } }
    if (!uniq.length) return 'Fant ingen registrerte steder (' + cat + ') innenfor ' + Math.round(rad / 1000) + ' km av ' + (name || place) + ' i OpenStreetMap.';
    return 'Steder (' + cat + ') nær ' + (name || place) + ' (kilde: OpenStreetMap):\n' + uniq.slice(0, 15).join('\n');
  } catch (e) {
    clearTimeout(to);
    return 'Kunne ikke hente stedsdata akkurat nå (' + (e.name === 'AbortError' ? 'tidsavbrudd' : String(e)) + ').';
  }
}

async function getWeather(input) {
  let { place, lat, lon } = input || {};
  let name = place || '';
  if ((lat == null || lon == null) && place) {
    const g = await geocode(place);
    if (!g) return 'Fant ikke stedet «' + place + '».';
    lat = g.lat; lon = g.lon; name = g.name;
  }
  if (lat == null || lon == null) return 'Mangler posisjon (lat/lon eller stedsnavn).';
  const url = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=' + (+lat).toFixed(4) + '&lon=' + (+lon).toFixed(4);
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return 'Værtjenesten svarte ikke (' + r.status + ').';
  const j = await r.json();
  const ts = j.properties && j.properties.timeseries && j.properties.timeseries[0];
  if (!ts) return 'Ingen værdata tilgjengelig.';
  const d = ts.data.instant.details || {};
  const n1 = ts.data.next_1_hours || ts.data.next_6_hours || {};
  const sym = (n1.summary && n1.summary.symbol_code) || '';
  const precip = n1.details && n1.details.precipitation_amount;
  const p = [];
  p.push('Sted: ' + (name || (lat + ', ' + lon)));
  p.push('Tid: ' + ts.time);
  if (d.air_temperature != null) p.push('Temp: ' + d.air_temperature + '°C');
  if (d.wind_speed != null) p.push('Vind: ' + d.wind_speed + ' m/s' + (d.wind_from_direction != null ? ' fra ' + compass(d.wind_from_direction) : ''));
  if (d.wind_speed_of_gust != null) p.push('Vindkast: ' + d.wind_speed_of_gust + ' m/s');
  if (precip != null) p.push('Nedbør neste time: ' + precip + ' mm');
  if (d.cloud_area_fraction != null) p.push('Skydekke: ' + Math.round(d.cloud_area_fraction) + '%');
  if (sym) p.push('Forhold: ' + sym);
  p.push('Kilde: MET Norway / Yr.');
  return p.join('. ');
}

exports.handler = async (event) => {
  // GET-geokoding for kartet (serveren setter riktig User-Agent som Nominatim krever):
  //   /.netlify/functions/claude?geocode=Aure
  if (event.httpMethod === 'GET') {
    const q = (event.queryStringParameters || {}).geocode;
    if (!q) return { statusCode: 400, body: JSON.stringify({ feil: 'mangler geocode' }) };
    try {
      const g = await geocode(q);
      return { statusCode: 200, body: JSON.stringify(g || {}) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ feil: 'Geokoding feilet', detalj: String(e) }) };
    }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ feil: 'Bruk POST' }) };
  }
  try {
    const { messages, max_tokens = 1000, system, tools } = JSON.parse(event.body || '{}');
    if (!process.env.ANTHROPIC_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ feil: 'ANTHROPIC_API_KEY mangler' }) };
    }
    if (!Array.isArray(messages)) {
      return { statusCode: 400, body: JSON.stringify({ feil: 'messages må være en array' }) };
    }

    const convo = messages.slice();
    let last = null;

    // Inntil 4 runder: lar Claude kalle verktøy (vær) og så svare ferdig.
    for (let i = 0; i < 4; i++) {
      const body = { model: 'claude-sonnet-4-6', max_tokens, messages: convo };
      if (system) body.system = system;
      if (tools) body.tools = tools;

      const res = await callAnthropic(body);
      if (!res.ok) return { statusCode: res.status, body: JSON.stringify(res.data) };
      last = res.data;

      if (last.stop_reason !== 'tool_use') break;

      convo.push({ role: 'assistant', content: last.content });
      const toolResults = [];
      for (const block of last.content) {
        if (block.type === 'tool_use') {
          let result = 'Ukjent verktøy.';
          try {
            if (block.name === 'get_weather') result = await getWeather(block.input || {});
            else if (block.name === 'find_places') result = await findPlaces(block.input || {});
          } catch (e) {
            result = 'Verktøyfeil: ' + String(e);
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        }
      }
      convo.push({ role: 'user', content: toolResults });
    }

    return { statusCode: 200, body: JSON.stringify(last) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ feil: 'Proxy-feil', detalj: String(err) }) };
  }
};
