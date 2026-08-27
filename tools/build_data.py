#!/usr/bin/env python3
"""Turn the Workbench's extraction output into the map's data file.

Input:
  req2-essex.csv                 the table as imported into Map your Data (from TNA Discovery)
  req2-essex-extraction.json     the Workbench's per-reading results, exported from the browser

Output:
  data/places.json               what index.html reads

This does no extraction and no matching of its own. Every place, coordinate and identifier here was
established by the Workbench; this script only groups mentions by place and drops what the run has
not reached yet.
"""
import csv, json, sys, datetime
from collections import OrderedDict

src_csv, src_json, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

rows = list(csv.DictReader(open(src_csv)))
ex = json.load(open(src_json))
col_names = {c: n for c, n in zip(ex['cols'], ex['colNames'])}

places, unlocated = OrderedDict(), OrderedDict()
rows_read = set()

for key, found in ex['results'].items():
    ri, ci = (int(x) for x in key.split('::'))
    rows_read.add(ri)
    rec = rows[ri]
    role = col_names[ci]
    for p in found:
        mention = {
            'ref': rec['reference'], 'tna': rec['tna_id'], 'date': rec['date'],
            'title': rec['short_title'], 'role': role, 'context': p.get('context') or '',
        }
        # The county itself is named in nearly every entry and resolves every time, so it would arrive
        # as one enormous dot over the middle of Essex telling the reader what they already know. It is
        # the container of this whole dataset, not a finding within it.
        if p['name'].strip().lower() == 'essex':
            continue
        m = p.get('match') or {}
        if m.get('lng') is None or m.get('lat') is None:
            # Named, but WHG could not locate it inside Essex. Kept and counted: about half of these
            # are real places the gazetteer does not yet hold.
            u = unlocated.setdefault(p['name'], {'name': p['name'], 'count': 0})
            u['count'] += 1
            continue
        pl = places.setdefault(m.get('id') or p['name'], {
            'name': m.get('title') or p['name'], 'whg_id': m.get('id') or '',
            'lon': m['lng'], 'lat': m['lat'], 'mentions': [],
        })
        pl['mentions'].append(mention)

places = [p for p in places.values()]
places.sort(key=lambda p: -len(p['mentions']))
lons = [p['lon'] for p in places]; lats = [p['lat'] for p in places]

out = {
    'generated': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'county': 'Essex', 'container': 'ukhc:ESE', 'series': 'TNA REQ 2',
    'fields_read': ex['colNames'],
    'records_total': len(rows), 'records_read': len(rows_read),
    'centre': [sum(lons) / len(lons), sum(lats) / len(lats)] if lons else [0.5, 51.8],
    'bounds': [[min(lons), min(lats)], [max(lons), max(lats)]] if lons else None,
    'places': places,
    'unlocated': sorted(unlocated.values(), key=lambda u: (-u['count'], u['name'])),
}
json.dump(out, open(out_path, 'w'), indent=1)
print('records read %d/%d · places %d · mentions %d · unlocated names %d' % (
    out['records_read'], out['records_total'], len(places),
    sum(len(p['mentions']) for p in places), len(out['unlocated'])))
