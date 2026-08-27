// Mapping the Elizabethan Court of Requests — places extracted from TNA REQ 2 catalogue
// descriptions with the World Historical Gazetteer Workbench. See README.md for how the data is made.
//
// The whole app is a thin reader over data/places.json, which is the Workbench's own output. Nothing
// is computed here that the Workbench did not already establish; this file only draws it.

const DATA = 'data/places.json';
const STYLE = 'https://tiles.whgazetteer.org/styles/whg-context/style.json';
const ROLES = {
  subject:    { label: 'disputed property',      colour: '#b3452f' },
  plaintiffs: { label: "plaintiff's residence",  colour: '#2f6b8f' },
};
const DISCOVERY = id => `https://discovery.nationalarchives.gov.uk/details/r/${id}`;

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

let DB = null, map = null;
const active = new Set(Object.keys(ROLES));

// ── data → GeoJSON ───────────────────────────────────────────────────────────
// A place is one feature. Its size follows the number of CASES that mention it (not mentions), since
// a case naming a place three times is still one case; its colour follows whichever role dominates.
function toGeoJSON(places) {
  return {
    type: 'FeatureCollection',
    features: places.map((p, i) => {
      const shown = p.mentions.filter(m => active.has(m.role));
      const cases = new Set(shown.map(m => m.ref)).size;
      const byRole = {};
      shown.forEach(m => { byRole[m.role] = (byRole[m.role] || 0) + 1; });
      const dominant = Object.keys(byRole).sort((a, b) => byRole[b] - byRole[a])[0] || 'subject';
      return {
        type: 'Feature',
        id: i,
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { idx: i, name: p.name, cases, role: dominant, hidden: shown.length ? 0 : 1 },
      };
    }).filter(f => !f.properties.hidden),
  };
}

function refresh() {
  const src = map.getSource('places');
  if (src) src.setData(toGeoJSON(DB.places));
  for (const role of Object.keys(ROLES)) {
    const n = DB.places.reduce((t, p) => t + p.mentions.filter(m => m.role === role).length, 0);
    $('#n-' + role).textContent = `(${n.toLocaleString()})`;
  }
}

// ── popup ────────────────────────────────────────────────────────────────────
// Catalogue detail is embedded, because Discovery sends no CORS header and a static site therefore
// cannot call it from the browser. We try anyway, once per case, and quietly keep the embedded copy
// when the request is blocked — so the popup would simply get richer if TNA ever allowed it.
async function enrich(tnaId, el) {
  if (!tnaId) return;
  try {
    const r = await fetch(`https://discovery.nationalarchives.gov.uk/API/records/v1/details/${encodeURIComponent(tnaId)}`,
      { headers: { Accept: 'application/json' } });
    if (!r.ok) return;
    const j = await r.json();
    const extra = [j.heldBy, j.physicalDescription, j.accessConditions].filter(Boolean).join(' · ');
    if (extra) { el.textContent = extra; el.hidden = false; }
  } catch (_) { /* no CORS — the embedded description already shown is the fallback */ }
}

function popupHTML(place) {
  const shown = place.mentions.filter(m => active.has(m.role));
  const cases = new Set(shown.map(m => m.ref));
  const rows = shown.map(m => `
    <li>
      <a class="ref" href="${DISCOVERY(m.tna)}" target="_blank" rel="noopener">${esc(m.ref)}</a>
      <span class="role role-${m.role}">${esc(ROLES[m.role].label)}</span>
      ${m.date ? ` <span class="ctx">${esc(m.date)}</span>` : ''}
      ${m.title ? `<span class="ctx">${esc(m.title)}</span>` : ''}
      ${m.context ? `<span class="ctx">&ldquo;${esc(m.context)}&rdquo;</span>` : ''}
      <span class="ctx tna-extra" data-tna="${esc(m.tna)}" hidden></span>
    </li>`).join('');
  return `<div class="pop">
      <h2>${esc(place.name)}</h2>
      <p class="sub">${plural(cases.size, 'case', 'cases')}
        ${place.whg_id ? ` · <a href="https://whgazetteer.org/places/${esc(place.whg_id)}/portal/" target="_blank" rel="noopener">WHG record</a>` : ''}</p>
      <ol>${rows}</ol>
    </div>`;
}

function openPlace(i) {
  const p = DB.places[i];
  const popup = new maplibregl.Popup({ maxWidth: '23rem' })
    .setLngLat([p.lon, p.lat]).setHTML(popupHTML(p)).addTo(map);
  popup.getElement().querySelectorAll('.tna-extra').forEach(el => enrich(el.dataset.tna, el));
  map.easeTo({ center: [p.lon, p.lat], duration: 500 });
}

// ── search ───────────────────────────────────────────────────────────────────
function wireSearch() {
  const input = $('#search'), list = $('#results');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { list.hidden = true; list.innerHTML = ''; return; }
    const hits = DB.places
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.name.toLowerCase().includes(q))
      .sort((a, b) => b.p.mentions.length - a.p.mentions.length)
      .slice(0, 25);
    list.innerHTML = hits.map(({ p, i }) =>
      `<li data-i="${i}" tabindex="0">${esc(p.name)} <em>${plural(new Set(p.mentions.map(m => m.ref)).size, 'case', 'cases')}</em></li>`).join('')
      || '<li><em>nothing of that name was located in Essex</em></li>';
    list.hidden = false;
  });
  list.addEventListener('click', e => {
    const li = e.target.closest('li[data-i]');
    if (li) openPlace(Number(li.dataset.i));
  });
}

// ── boot ─────────────────────────────────────────────────────────────────────
(async function init() {
  DB = await fetch(DATA).then(r => r.json());

  const cases = new Set(DB.places.flatMap(p => p.mentions.map(m => m.ref))).size;
  const mentions = DB.places.reduce((t, p) => t + p.mentions.length, 0);
  $('#stats').innerHTML = `
    <dt>Records read</dt><dd>${DB.records_read.toLocaleString()} of ${DB.records_total.toLocaleString()}</dd>
    <dt>Places located</dt><dd>${DB.places.length.toLocaleString()}</dd>
    <dt>Mentions</dt><dd>${mentions.toLocaleString()}</dd>
    <dt>Cases with a place</dt><dd>${cases.toLocaleString()}</dd>`;

  $('#n-unlocated').textContent = `(${DB.unlocated.length.toLocaleString()})`;
  $('#unlocated').innerHTML = DB.unlocated
    .map(u => `<li>${esc(u.name)}${u.count > 1 ? ` <em>&times;${u.count}</em>` : ''}</li>`).join('');

  map = new maplibregl.Map({
    container: 'map', style: STYLE, center: DB.centre || [0.5, 51.8], zoom: 8.4,
    attributionControl: { customAttribution:
      'Places: <a href="https://whgazetteer.org/">WHG</a> · Catalogue: <a href="https://discovery.nationalarchives.gov.uk/">TNA</a> (OGL v3.0)' },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-right');

  map.on('load', () => {
    map.addSource('places', { type: 'geojson', data: toGeoJSON(DB.places) });
    map.addLayer({
      id: 'places-circles', type: 'circle', source: 'places',
      paint: {
        // Area, not radius, follows the case count — so a place in ten cases looks ten times the
        // weight of one in a single case rather than a hundred.
        'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'cases']], 1, 5, 3, 11, 7, 22],
        'circle-color': ['match', ['get', 'role'],
          'plaintiffs', ROLES.plaintiffs.colour, ROLES.subject.colour],
        'circle-opacity': .72,
        'circle-stroke-width': 1, 'circle-stroke-color': '#fbfaf7', 'circle-stroke-opacity': .9,
      },
    });
    map.addLayer({
      id: 'places-labels', type: 'symbol', source: 'places',
      minzoom: 9,
      layout: {
        'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.1],
        'text-anchor': 'top', 'text-allow-overlap': false,
      },
      paint: { 'text-color': '#23201c', 'text-halo-color': '#fbfaf7', 'text-halo-width': 1.4 },
    });

    map.on('click', 'places-circles', e => openPlace(e.features[0].properties.idx));
    map.on('mouseenter', 'places-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'places-circles', () => { map.getCanvas().style.cursor = ''; });

    if (DB.bounds) map.fitBounds(DB.bounds, { padding: { top: 40, right: 40, bottom: 40, left: 360 }, duration: 0 });
    $('#loading').classList.add('done');
  });

  map.on('error', e => {
    // A basemap that fails to load must not take the points with it.
    console.warn('[map]', e && e.error && e.error.message);
    $('#loading').classList.add('done');
  });

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
