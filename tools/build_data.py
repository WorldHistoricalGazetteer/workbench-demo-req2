#!/usr/bin/env python3
"""Turn the Workbench sweep output into the map's data files.

Input:
  sweep/manifest.json      per-county status, written by the sweep as it goes
  sweep/<County>.jsonl     one line per reading (record x field), with the places found

Output:
  data/places.json         every located place: name, WHG id, coordinates, per-role counts, county
  data/mentions/<County>.json   the mention detail, fetched only when a popup opens
  data/progress.json       which counties are done, for the panel

The split is deliberate. The map needs coordinates and counts to draw; it needs the case references,
dates and titles only for the one place a reader clicks. Keeping them apart means the first paint
stays small however many counties are swept, and it is a smaller change than tiling would be if the
point count ever justifies PMTiles.

This does no extraction and no matching. Every place, coordinate and identifier was established by the
Workbench; this only groups mentions by place and drops what has not been reached yet.
"""
import datetime, json, os, sys
from collections import OrderedDict

SWEEP, OUT = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(OUT, 'mentions'), exist_ok=True)

# The FILES are the source of truth, not the manifest. The manifest is written by the sweep, and once
# extraction moved to CRC the sweep stopped being the thing that produces readings — so a manifest with
# ten counties in it was quietly hiding forty-one counties' worth of ingested data from the map.
# Anything with a .jsonl is real; the manifest only supplies the record count where it happens to know.
manifest = {}
mpath = os.path.join(SWEEP, 'manifest.json')
if os.path.exists(mpath):
    try:
        manifest = json.load(open(mpath))['counties']
    except Exception:
        manifest = {}

places, progress, mentions_by_county = OrderedDict(), [], {}
totals = {'records': 0, 'readings': 0, 'mentions': 0, 'unlocated': 0}
unlocated = OrderedDict()

counties = sorted(fn[:-6].replace('_', ' ') for fn in os.listdir(SWEEP) if fn.endswith('.jsonl'))
for county in counties:
    meta = manifest.get(county, {})
    path = os.path.join(SWEEP, county.replace(' ', '_') + '.jsonl')
    if not os.path.exists(path):
        continue
    seen_cases, county_mentions, readings = set(), [], 0
    for line in open(path):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        readings += 1
        # The earliest Essex readings predate the sweep layout and carry no county key; the file they
        # are in is the answer.
        r.setdefault('county', county)
        seen_cases.add(r['ref'])
        for p in r.get('places') or []:
            # The county itself is named in nearly every entry of its own set and resolves every time,
            # so it would be one huge dot saying what the reader already knows. It is the container of
            # that subset, not a finding within it.
            if p['name'].strip().lower() == county.strip().lower():
                continue
            m = p.get('match') or {}
            if m.get('lng') is None or m.get('lat') is None:
                u = unlocated.setdefault((county, p['name']),
                                         {'name': p['name'], 'county': county, 'count': 0})
                u['count'] += 1
                totals['unlocated'] += 1
                continue
            key = m.get('id') or p['name']
            pl = places.setdefault(key, {
                'name': m.get('title') or p['name'], 'whg_id': m.get('id') or '',
                'lon': round(m['lng'], 5), 'lat': round(m['lat'], 5),
                'county': county, 'roles': {}, 'cases': set(),
            })
            pl['roles'][r['col']] = pl['roles'].get(r['col'], 0) + 1
            pl['cases'].add(r['ref'])
            county_mentions.append({'p': key, 'ref': r['ref'], 'tna': r['tna'], 'date': r['date'],
                                    'title': r['title'], 'role': r['col'],
                                    'ctx': (p.get('context') or '')[:220]})
            totals['mentions'] += 1
    mentions_by_county[county] = county_mentions
    # Where the manifest has no record count, the distinct case references in the file are the count.
    records = meta.get('records') or len(seen_cases)
    totals['records'] += records
    totals['readings'] += readings
    progress.append({'county': county, 'records': records, 'cases': len(seen_cases),
                     'mentions': len(county_mentions)})

for county, ms in mentions_by_county.items():
    json.dump(ms, open(os.path.join(OUT, 'mentions', county.replace(' ', '_') + '.json'), 'w'))

out_places = []
for p in places.values():
    p['cases'] = len(p['cases'])
    out_places.append(p)
out_places.sort(key=lambda p: -p['cases'])

lons = [p['lon'] for p in out_places]; lats = [p['lat'] for p in out_places]
json.dump({
    'generated': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'series': 'TNA REQ 2', 'fields_read': ['subject', 'plaintiffs'],
    'totals': totals, 'counties': len([p for p in progress if p['mentions']]),
    'bounds': [[min(lons), min(lats)], [max(lons), max(lats)]] if lons else None,
    'places': out_places,
}, open(os.path.join(OUT, 'places.json'), 'w'))
json.dump({'counties': sorted(progress, key=lambda c: -c['mentions']),
           'unlocated': sorted(unlocated.values(), key=lambda u: (-u['count'], u['name']))},
          open(os.path.join(OUT, 'progress.json'), 'w'))

print('counties %d · records %d · readings %d · places %d · mentions %d · unlocated %d'
      % (len([p for p in progress if p['mentions']]), totals['records'],
         totals['readings'], len(out_places), totals['mentions'], totals['unlocated']))
