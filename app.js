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
const DISCOVERY = id => `https://discovery.nationalarchives.gov.uk/details/r/${id}`;

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
    const shown = Object.keys(p.roles).filter(r => active.has(r));
    const dominant = shown.sort((a, b) => p.roles[b] - p.roles[a])[0] || 'subject';
    feats.push({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                 properties: { idx: i, name: p.name, cases: p.cases, role: dominant } });
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
  const list = shown.map(m => `
    <li>
      <a class="ref" href="${DISCOVERY(m.tna)}" target="_blank" rel="noopener">${esc(m.ref)}</a>
      <span class="role role-${m.role}">${esc(ROLES[m.role].label)}</span>
      ${m.date ? ` <span class="ctx">${esc(m.date)}</span>` : ''}
      ${m.title ? `<span class="ctx">${esc(m.title)}</span>` : ''}
      ${m.ctx ? `<span class="ctx">&ldquo;${esc(m.ctx)}&rdquo;</span>` : ''}
    </li>`).join('');
  return `<div class="pop">
      <h2>${esc(place.name)}</h2>
      <p class="sub">${plural(cases.size, 'case', 'cases')}
        <span class="county">· ${esc(place.county)}</span>
        ${place.whg_id ? ` · <a href="https://whgazetteer.org/places/${esc(place.whg_id)}/portal/" target="_blank" rel="noopener">WHG record</a>` : ''}</p>
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
    <dt>Counties swept</dt><dd>${DB.counties_done} of ${DB.counties_total}</dd>
    <dt>Records read</dt><dd>${t.records.toLocaleString()}</dd>
    <dt>Places located</dt><dd>${DB.places.length.toLocaleString()}</dd>
    <dt>Mentions</dt><dd>${t.mentions.toLocaleString()}</dd>`;
  $('#progress-fill').style.width = (100 * DB.counties_done / DB.counties_total).toFixed(1) + '%';
  const running = PROG.counties.find(c => c.status !== 'done');
  $('#progress-note').textContent = running
    ? `Currently reading ${running.county}. Counties are visited in an order that jumps around the country, so the map spreads early rather than creeping outwards.`
    : 'Every county has been read.';

  const sel = $('#county');
  PROG.counties.filter(c => c.mentions).sort((a, b) => a.county.localeCompare(b.county))
    .forEach(c => sel.insertAdjacentHTML('beforeend',
      `<option value="${esc(c.county)}">${esc(c.county)} — ${plural(c.mentions, 'mention', 'mentions')}</option>`));
  sel.addEventListener('change', () => {
    county = sel.value;
    refresh();
    const pts = DB.places.filter(p => !county || p.county === county);
    if (pts.length) {
      const lons = pts.map(p => p.lon), lats = pts.map(p => p.lat);
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: { top: 40, right: 40, bottom: 40, left: 360 }, duration: 700 });
    }
  });

  $('#n-unlocated').textContent = `(${PROG.unlocated.length.toLocaleString()})`;
  $('#unlocated').innerHTML = PROG.unlocated.slice(0, 400)
    .map(u => `<li>${esc(u.name)}${u.count > 1 ? ` <em>&times;${u.count}</em>` : ''}</li>`).join('');

  map = new maplibregl.Map({
    container: 'map', style: STYLE, center: [-2.2, 52.6], zoom: 5.6,
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
    map.addLayer({
      id: 'places-circles', type: 'circle', source: 'places',
      paint: {
        // Area, not radius, follows the case count, so ten cases read as ten times one rather than a
        // hundred times.
        'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'cases']], 1, 4, 3, 9, 8, 20],
        'circle-color': ['match', ['get', 'role'], 'plaintiffs', ROLES.plaintiffs.colour, ROLES.subject.colour],
        // A detailed basemap is busy, so the points need to hold their own.
        'circle-opacity': .85, 'circle-stroke-width': 1.5,
        'circle-stroke-color': '#fff', 'circle-stroke-opacity': .95,
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
    if (DB.bounds) map.fitBounds(DB.bounds, { padding: { top: 40, right: 40, bottom: 40, left: 360 }, duration: 0 });
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
