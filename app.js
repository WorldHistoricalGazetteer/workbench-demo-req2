// Mapping the Elizabethan Court of Requests — places extracted from TNA REQ 2 catalogue descriptions
// with the World Historical Gazetteer Workbench, county by county across England and Wales.
// See README.md for how the data is made.
//
// The app is a thin reader over the Workbench's own output. Nothing is computed here that the
// Workbench did not establish; this file only draws it.
//
// Two data files, deliberately: places.json carries what the MAP needs (coordinates, counts) and is
// loaded up front; the mention detail — case references, dates, titles — is sharded per county under
// mentions/ and fetched only when a popup opens. First paint therefore stays small however many
// counties have been swept.

const PLACES = 'data/places.json';
const PROGRESS = 'data/progress.json';
const MENTIONS = c => `data/mentions/${c.replace(/ /g, '_')}.json`;
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const ROLES = {
  subject:    { label: 'disputed property',     colour: '#b3452f' },
  plaintiffs: { label: "plaintiff's residence", colour: '#2f6b8f' },
};
// A place named in BOTH fields is not a shade of either — it is somewhere people lived AND litigated
// over, which is a different kind of place from an outlying manor that only ever appears as disputed
// property. Colouring it by whichever role happened to be commoner threw that away. Purple because it
// reads as the two mixed rather than as a third unrelated thing.
const BOTH = { label: 'both', colour: '#7b3f8f' };
const DISCOVERY = id => `https://discovery.nationalarchives.gov.uk/details/r/${id}`;
// Left padding clears the panel, so fitting to the data never parks points underneath it.
const FIT_PAD = { top: 40, right: 40, bottom: 40, left: 360 };

// ── basemap: OSM's colours, turned down ──────────────────────────────────────
// Liberty is a general-purpose style, coloured to be read on its own: green woods, blue water, ochre
// motorways. Under a thematic overlay all of that competes with the data — the eye cannot tell a red
// A-road from a red marker at a glance. Rather than swap to a grey style and lose the context that
// makes this map worth looking at, every colour in the style is pulled towards grey and lightened a
// little, so the roads, rivers and coastline stay legible as SHAPE while surrendering colour to the
// points drawn on top.
const SATURATION = 0.28;   // of the original; 0 would be fully grey
const LIGHTEN = 0.13;      // toward white, so the markers sit on a paler ground

function toHsl(c) {
  let r, g, b, a = 1;
  let m = /^#([0-9a-f]{3,8})$/i.exec(c.trim());
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('');
    r = parseInt(h.slice(0, 2), 16) / 255; g = parseInt(h.slice(2, 4), 16) / 255;
    b = parseInt(h.slice(4, 6), 16) / 255;
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
  } else if ((m = /^rgba?\(([^)]+)\)$/i.exec(c.trim()))) {
    const p = m[1].split(',').map(x => parseFloat(x));
    r = p[0] / 255; g = p[1] / 255; b = p[2] / 255;
    if (p.length > 3) a = p[3];
  } else return null;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, sat = 0;
  if (mx !== mn) {
    const d = mx - mn;
    sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return { h, s: sat, l, a };
}

function hslToCss({ h, s, l, a }) {
  return `hsla(${(h * 360).toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%, ${a})`;
}

// Colours hide inside expressions (`['interpolate', …, 8, '#fff', 14, '#eee']`), so walk everything
// and convert any string that parses as a colour, leaving the structure untouched.
function muted(node) {
  if (typeof node === 'string') {
    const hsl = toHsl(node);
    if (!hsl) return node;
    hsl.s *= SATURATION;
    hsl.l = hsl.l + (1 - hsl.l) * LIGHTEN;
    return hslToCss(hsl);
  }
  if (Array.isArray(node)) return node.map(muted);
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[k] = muted(node[k]);
    return out;
  }
  return node;
}

async function basemapStyle() {
  const style = await fetch(STYLE).then(r => r.json());
  style.layers = style.layers.map(l => (l.paint ? { ...l, paint: muted(l.paint) } : l));
  return style;
}

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

let DB = null, PROG = null, map = null, county = '';
const active = new Set(Object.keys(ROLES));
const mentionCache = new Map();   // county → mentions, fetched once and kept for the session

// ── data → GeoJSON ───────────────────────────────────────────────────────────
// A place is one feature, sized by the number of CASES that mention it — a case naming a place three
// times is still one case — and coloured by whichever role dominates there.
function visible(p) {
  if (county && p.county !== county) return 0;
  return Object.keys(p.roles).reduce((t, r) => t + (active.has(r) ? p.roles[r] : 0), 0);
}

function toGeoJSON() {
  const feats = [];
  DB.places.forEach((p, i) => {
    const n = visible(p);
    if (!n) return;
    const shown = Object.keys(p.roles).filter(r => active.has(r) && p.roles[r]);
    // 'both' is derived from what is currently SHOWN, so hiding a role collapses a both-place back to
    // the role that remains — the filter keeps meaning what it says.
    const kind = shown.length > 1 ? 'both'
               : shown.sort((a, b) => p.roles[b] - p.roles[a])[0] || 'subject';
    feats.push({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                 properties: { idx: i, name: p.name, cases: p.cases, role: kind } });
  });
  return { type: 'FeatureCollection', features: feats };
}

function refresh() {
  const src = map && map.getSource('places');
  if (src) src.setData(toGeoJSON());
  for (const role of Object.keys(ROLES)) {
    const n = DB.places.reduce((t, p) =>
      t + ((county && p.county !== county) ? 0 : (p.roles[role] || 0)), 0);
    $('#n-' + role).textContent = `(${n.toLocaleString()})`;
  }
  const both = DB.places.filter(p => (!county || p.county === county)
    && Object.keys(p.roles).filter(r => active.has(r) && p.roles[r]).length > 1).length;
  $('#n-both').textContent = `(${both.toLocaleString()})`;
  $('#both-key').hidden = !both;
}

// ── popup ────────────────────────────────────────────────────────────────────
// Catalogue detail is embedded rather than fetched from TNA: Discovery serves no
// Access-Control-Allow-Origin header, so a static site cannot call its API from a browser at all.
// Each case links out to the authoritative record instead.
async function mentionsFor(c) {
  if (!mentionCache.has(c)) {
    try { mentionCache.set(c, await fetch(MENTIONS(c)).then(r => r.json())); }
    catch (_) { mentionCache.set(c, []); }
  }
  return mentionCache.get(c);
}

function popupHTML(place, rows) {
  const shown = rows.filter(m => active.has(m.role));
  const cases = new Set(shown.map(m => m.ref));
  // Most places only ever appear in one field, so stamping the same role on every line said nothing
  // twenty times over. State it once, up top; mark individual lines only where a place really does
  // play both parts — which is the interesting case, and now the only one that draws the eye.
  const kinds = [...new Set(shown.map(m => m.role))];
  const mixed = kinds.length > 1;
  const roleLine = kinds.map(k =>
    `<span class="role role-${k}">${esc(ROLES[k].label)}</span>`).join(' ');
  const list = shown.map(m => `
    <li>
      <a class="ref" href="${DISCOVERY(m.tna)}" target="_blank" rel="noopener">${esc(m.ref)}</a>
      ${mixed ? `<span class="role role-${m.role}">${esc(ROLES[m.role].label)}</span>` : ''}
      ${m.date ? ` <span class="ctx">${esc(m.date)}</span>` : ''}
      ${m.title ? `<span class="ctx">${esc(m.title)}</span>` : ''}
      ${m.ctx ? `<span class="ctx">&ldquo;${esc(m.ctx)}&rdquo;</span>` : ''}
    </li>`).join('');
  return `<div class="pop">
      <h2>${esc(place.name)}</h2>
      <p class="sub">${plural(cases.size, 'case', 'cases')}
        <span class="county">· ${esc(place.county)}</span>
        ${place.whg_id ? ` · <a href="https://whgazetteer.org/places/${esc(place.whg_id)}/portal/" target="_blank" rel="noopener">WHG record</a>` : ''}</p>
      <p class="roles">${roleLine}</p>
      <ol>${list}</ol>
    </div>`;
}

async function openPlace(i) {
  const p = DB.places[i];
  const popup = new maplibregl.Popup({ maxWidth: '23rem' })
    .setLngLat([p.lon, p.lat])
    .setHTML(`<div class="pop"><h2>${esc(p.name)}</h2><p class="loading">Fetching the cases…</p></div>`)
    .addTo(map);
  map.easeTo({ center: [p.lon, p.lat], duration: 500 });
  const rows = (await mentionsFor(p.county)).filter(m => m.p === (p.whg_id || p.name));
  if (popup.isOpen()) popup.setHTML(popupHTML(p, rows));
}

// ── search ───────────────────────────────────────────────────────────────────
function wireSearch() {
  const input = $('#search'), list = $('#results');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { list.hidden = true; list.innerHTML = ''; return; }
    const hits = DB.places.map((p, i) => ({ p, i }))
      .filter(({ p }) => p.name.toLowerCase().includes(q) && (!county || p.county === county))
      .sort((a, b) => b.p.cases - a.p.cases).slice(0, 25);
    list.innerHTML = hits.map(({ p, i }) =>
      `<li data-i="${i}" tabindex="0">${esc(p.name)} <em>${plural(p.cases, 'case', 'cases')} · ${esc(p.county)}</em></li>`
    ).join('') || '<li><em>nothing of that name has been located yet</em></li>';
    list.hidden = false;
  });
  list.addEventListener('click', e => {
    const li = e.target.closest('li[data-i]');
    if (li) openPlace(Number(li.dataset.i));
  });
}

// ── boot ─────────────────────────────────────────────────────────────────────
(async function init() {
  [DB, PROG] = await Promise.all([fetch(PLACES).then(r => r.json()),
                                  fetch(PROGRESS).then(r => r.json())]);
  const t = DB.totals;
  $('#stats').innerHTML = `
    <dt>Counties</dt><dd>${(DB.counties || PROG.counties.filter(c => c.mentions).length).toLocaleString()}</dd>
    <dt>Records read</dt><dd>${t.records.toLocaleString()}</dd>
    <dt>Places located</dt><dd>${DB.places.length.toLocaleString()}</dd>
    <dt>Mentions</dt><dd>${t.mentions.toLocaleString()}</dd>`;

  const sel = $('#county');
  PROG.counties.filter(c => c.mentions).sort((a, b) => a.county.localeCompare(b.county))
    .forEach(c => sel.insertAdjacentHTML('beforeend',
      `<option value="${esc(c.county)}">${esc(c.county)} — ${plural(c.mentions, 'mention', 'mentions')}</option>`));
  sel.addEventListener('change', () => {
    county = sel.value;
    refresh();
    renderUnlocated();
    const pts = DB.places.filter(p => !county || p.county === county);
    if (pts.length) {
      const lons = pts.map(p => p.lon), lats = pts.map(p => p.lat);
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: FIT_PAD, maxZoom: 10, duration: 700 });
    }
  });

  // Across a whole sweep this list runs to thousands of names and tells the reader nothing: a wall of
  // unfamiliar words with no way in. Per county it is a working document — the names a historian of
  // that county could actually recognise, and the shortlist of places worth contributing to the
  // gazetteer. So it appears only once a county is chosen.
  function renderUnlocated() {
    const wrap = $('#unlocated-wrap');
    if (!county) { wrap.hidden = true; wrap.open = false; return; }
    const rows = PROG.unlocated.filter(u => u.county === county);
    wrap.hidden = !rows.length;
    $('#unlocated-county').textContent = county;
    $('#n-unlocated').textContent = `(${rows.length.toLocaleString()})`;
    $('#unlocated').innerHTML = rows
      .map(u => `<li>${esc(u.name)}${u.count > 1 ? ` <em>&times;${u.count}</em>` : ''}</li>`).join('');
  }
  renderUnlocated();

  map = new maplibregl.Map({
    container: 'map', style: await basemapStyle(), center: [-2.2, 52.6], zoom: 5.6,
    // The Liberty style credits OSM, OpenFreeMap and OpenMapTiles itself; this is what it cannot know.
    attributionControl: { compact: true, customAttribution:
      'Places: <a href="https://whgazetteer.org/">WHG</a> · '
      + 'Catalogue: <a href="https://discovery.nationalarchives.gov.uk/">TNA</a> (OGL v3.0)' },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-right');

  // 'style.load', not 'load': a style with many sources may never reach the fully-idle state 'load'
  // waits for, and hanging the data off it left the page behind an overlay that never lifted.
  map.on('style.load', () => {
    map.addSource('places', { type: 'geojson', data: toGeoJSON() });

    // Zoomed out, individual points are meaningless: a thousand overlapping dots over England and
    // Wales say only "there were cases". A heatmap answers the question that scale can actually
    // answer — where litigation clustered — and hands over to the circles as soon as the reader is
    // close enough for an individual place to mean something. The two cross-fade between z6 and z8,
    // so there is no moment where the map is empty or doubled.
    map.addLayer({
      id: 'places-heat', type: 'heatmap', source: 'places', maxzoom: 8.5,
      paint: {
        // A place in twenty cases should weigh more than one in a single case, but not twenty times
        // more, or one county town drowns its neighbours.
        // Tuned for the finished sweep, not the first county. These settings were chosen when the map
        // held 300 places; at 7,000 every part of England had enough density to hit the top of the
        // ramp, and the heatmap became a solid yellow silhouette of the country — which tells a
        // reader nothing except where the coast is. Lower weight and a tighter radius put the range
        // back where the variation is.
        'heatmap-weight': ['interpolate', ['linear'], ['sqrt', ['get', 'cases']], 1, 0.12, 12, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.35, 8, 0.9],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 9, 8, 24],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 6, .9, 8.5, 0],
        // Magma. The earlier ramp ran tan to brick and read as a stain — and worse, it was arbitrary:
        // three browns picked by eye are not ordered, so a reader could not tell a busy parish from a
        // quiet one without counting. Magma is perceptually uniform, so equal steps in litigation read
        // as equal steps in colour, and it happens to be vivid against a basemap we have deliberately
        // drained of colour. Violet where cases are thin, through magenta and orange, to near-white
        // where a county town blazes.
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
          0,    'rgba(12,7,45,0)',
          0.12, 'rgba(59,15,112,0.55)',
          0.32, 'rgba(140,41,129,0.72)',
          0.52, 'rgba(222,73,104,0.82)',
          0.74, 'rgba(254,159,109,0.88)',
          1,    'rgba(252,253,191,0.95)'],
      },
    });
    map.addLayer({
      id: 'places-circles', type: 'circle', source: 'places',
      paint: {
        // Area, not radius, follows the case count, so ten cases read as ten times one rather than a
        // hundred times.
        'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'cases']], 1, 4, 3, 9, 8, 20],
        'circle-color': ['match', ['get', 'role'],
          'plaintiffs', ROLES.plaintiffs.colour, 'both', BOTH.colour, ROLES.subject.colour],
        // A detailed basemap is busy, so the points need to hold their own.
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 8, .85],
        'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff',
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 8, .95],
      },
    });
    map.addLayer({
      id: 'places-labels', type: 'symbol', source: 'places', minzoom: 8,
      layout: {
        // OSM labels many of the same settlements, so ours are bold and in the accent colour, offset
        // below the point. 'Noto Sans Bold' is one of the three fontstacks Liberty's glyph server has.
        'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.2],
        'text-anchor': 'top', 'text-allow-overlap': false, 'text-font': ['Noto Sans Bold'],
      },
      paint: { 'text-color': '#7a2d1c', 'text-halo-color': '#fff', 'text-halo-width': 2 },
    });
    map.on('click', 'places-circles', e => openPlace(e.features[0].properties.idx));
    map.on('mouseenter', 'places-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'places-circles', () => { map.getCanvas().style.cursor = ''; });
    // The bounds come from the data, so they widen by themselves as counties are added — nothing to
    // maintain. maxZoom stops an early partial sweep from opening tight on one county, which would
    // make a map of England and Wales look like a map of Essex.
    if (DB.bounds) map.fitBounds(DB.bounds, { padding: FIT_PAD, maxZoom: 8, duration: 0 });
    $('#loading').classList.add('done');
  });

  map.on('error', e => { console.warn('[map]', e && e.error && e.error.message);
                         $('#loading').classList.add('done'); });
  setTimeout(() => $('#loading').classList.add('done'), 8000);

  document.querySelectorAll('#roles input').forEach(cb => cb.addEventListener('change', () => {
    cb.checked ? active.add(cb.dataset.role) : active.delete(cb.dataset.role);
    refresh();
  }));
  $('#panel-toggle').addEventListener('click', () => {
    const p = $('#panel');
    p.classList.toggle('collapsed');
    $('#panel-toggle').setAttribute('aria-expanded', String(!p.classList.contains('collapsed')));
  });
  wireSearch();
  refresh();
})();
