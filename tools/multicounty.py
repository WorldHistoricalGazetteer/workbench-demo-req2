"""Sweep the records whose County field names more than one county.

The original filter asked whether the County field EQUALLED a county name, so `County: Glamorgan;
Gloucestershire` matched neither and the record was dropped from both — 16% of the series, and
disproportionately the interesting cases, the ones that cross a border.

The pipeline always supported this: `contained_in` takes a list, so a record naming two counties is
searched inside the union of their polygons. Only the catalogue filter was wrong.

A record is filed under the FIRST county it names, so it appears once rather than in every county it
touches, but it is scoped by all of them.
"""
import json, os, re, sys, threading, time, urllib.parse, uuid
from concurrent.futures import ThreadPoolExecutor
import django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "whg.settings")
django.setup()
import logging; logging.disable(logging.INFO)
import requests
from django.contrib.auth import get_user_model
from django.db import connection as db_connection
from workbench.views import _ner_row_places

COUNTIES, SWEEP = sys.argv[1], sys.argv[2]
COLUMNS = ['subject', 'plaintiffs']
WORKERS = int(os.environ.get('MC_WORKERS', '3'))
BASE = "https://discovery.nationalarchives.gov.uk/API/search/records"
H = {"Accept": "application/json"}
FIELDS = ['Short Title', 'Plaintiffs', 'Defendants', 'Subject', 'County', 'Document type']
FIELD_RE = re.compile(r'(%s):\s*' % '|'.join(map(re.escape, FIELDS)))

# Spellings the catalogue uses for a county whose canonical name differs. Glamorganshire is the one
# that cost a whole county: it was absent from the original list, so Glamorgan never reached the map.
ALIASES = {
    'Salop': 'Shropshire', 'Brecon': 'Brecknockshire', 'Breconshire': 'Brecknockshire',
    'Caernarvonshire': 'Caernarfonshire', 'Carnarvonshire': 'Caernarfonshire',
    'Merioneth': 'Merionethshire', 'Ceredigion': 'Cardiganshire', 'County Durham': 'Durham',
    'Monmouth': 'Monmouthshire', 'Glamorganshire': 'Glamorgan', 'Glamorgansire': 'Glamorgan',
    'Yorks': 'Yorkshire', 'Salopshire': 'Shropshire',
}

counties = json.load(open(COUNTIES))['counties']
scope_of = {c['name']: c['container'] for c in counties}
canonical = {c['name'].lower(): c['name'] for c in counties}
for alt, canon in ALIASES.items():
    canonical[alt.lower()] = canon
user = get_user_model().objects.filter(is_superuser=True).first()


def parse(desc):
    d = re.sub(r'\s+', ' ', desc or '').strip()
    parts, out = FIELD_RE.split(d), {}
    for i in range(1, len(parts) - 1, 2):
        out[parts[i]] = parts[i + 1].strip().rstrip('.').strip()
    return out


def counties_in(field):
    """`Glamorgan; Gloucestershire` → ['Glamorgan', 'Gloucestershire'], canonical and de-duplicated."""
    out = []
    for bit in re.split(r'[;,]| and ', field or ''):
        name = canonical.get(bit.strip().rstrip('.').strip().lower())
        if name and name not in out:
            out.append(name)
    return out


def get_json(url, attempts=5):
    last = None
    for attempt in range(attempts):
        try:
            r = requests.get(url, headers=H, timeout=180)
            if r.status_code < 500:
                return r.json()
            last = RuntimeError(f'{r.status_code} from Discovery')
        except Exception as e:
            last = e
        time.sleep(5 * (attempt + 1))
    raise last


# Collect every multi-county record once, searching under each county term and its aliases.
records, seen_ids = {}, set()
terms = sorted({c['name'] for c in counties} | set(ALIASES))
for n, term in enumerate(terms, 1):
    q = urllib.parse.urlencode({'sps.recordSeries': 'REQ 2', 'sps.catalogueLevels': 'Level7',
        'sps.searchQuery': term, 'sps.dateFrom': '1558-01-01', 'sps.dateTo': '1603-12-31',
        'sps.resultsPageSize': 1000})
    for r in get_json(BASE + '?' + q).get('records') or []:
        rid = r.get('id') or ''
        if rid in seen_ids:
            continue
        seen_ids.add(rid)
        f = parse(r.get('description') or '')
        names = counties_in(f.get('County', ''))
        if len(names) < 2:
            continue                       # single-county records were already swept
        records[rid] = {
            'tna_id': rid, 'reference': r.get('reference') or '',
            'date': r.get('coveringDates') or '', 'counties': names,
            'short_title': f.get('Short Title', ''), 'plaintiffs': f.get('Plaintiffs', ''),
            'subject': f.get('Subject', ''),
        }
    if n % 10 == 0:
        print(f'  searched {n}/{len(terms)} terms · {len(records)} multi-county records so far', flush=True)
    time.sleep(0.2)

print(f'\n{len(records)} multi-county records found', flush=True)

# Skip anything already stored (nothing should be, but the run must be repeatable).
done = set()
for fn in os.listdir(SWEEP):
    if fn.endswith('.jsonl'):
        for line in open(os.path.join(SWEEP, fn)):
            try:
                done.add(json.loads(line)['unit'])
            except Exception:
                pass

units = [(r, col) for r in records.values() for col in COLUMNS
         if f"{r['tna_id']}::{col}" not in done]
print(f'{len(units)} readings to do', flush=True)

handles, lock, counter, t0 = {}, threading.Lock(), {'n': 0}, time.time()
for r in records.values():
    home = r['counties'][0]
    if home not in handles:
        handles[home] = open(os.path.join(SWEEP, home.replace(' ', '_') + '.jsonl'), 'a')


def work(item):
    r, col = item
    scope = [scope_of[c] for c in r['counties'] if c in scope_of]
    text = (r.get(col) or '').strip()
    try:
        places = _ner_row_places(text, user, scope, []) if text else []
        failed = False
    except Exception as e:
        print(f"  ! {r['tna_id']}::{col}: {e}", flush=True)
        places, failed = [], True
    finally:
        db_connection.close()
    rec = {'unit': f"{r['tna_id']}::{col}", 'col': col, 'county': r['counties'][0],
           'counties': r['counties'], 'ref': r['reference'], 'tna': r['tna_id'],
           'date': r['date'], 'title': r['short_title'], 'places': places}
    if failed:
        rec['failed'] = True
    with lock:
        handles[r['counties'][0]].write(json.dumps(rec) + '\n')
        handles[r['counties'][0]].flush()
        counter['n'] += 1
        n = counter['n']
    if n % 100 == 0:
        rate = (time.time() - t0) / n
        print(f'  {n}/{len(units)}  {rate:.2f}s each  ~{(len(units)-n)*rate/60:.0f} min left', flush=True)


with ThreadPoolExecutor(max_workers=WORKERS) as pool:
    list(pool.map(work, units))
for fh in handles.values():
    fh.close()
print(f'done: {counter["n"]} readings in {(time.time()-t0)/60:.1f} min', flush=True)
