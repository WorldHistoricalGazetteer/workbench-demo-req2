# Mapping the Elizabethan Court of Requests

An interactive map of the places named in **TNA REQ 2** — the pleadings of the Court of Requests,
c. 1558–1603 — across the historic counties of **England and Wales**, built end-to-end from an open
catalogue with no bespoke code.

**[→ Open the map](https://worldhistoricalgazetteer.github.io/workbench-demo-req2/)**

---

## Why this exists

The National Archives' Discovery catalogue describes some 22,000 Elizabethan Court of Requests cases.
Each description is a short, structured abstract:

> **Short Title:** Wrighte v Cowlande. **Plaintiffs:** Clement Wrighte of Great Easton, yeoman.
> **Defendants:** John Cowlande of Dovercourt. **Subject:** property in Upminster and Barking.
> **County:** Essex.

Sharon Howard's [map of the Elizabethan Court of Requests](https://inhermindseye.github.io/mindseye/posts/elizabethan-court-of-requests/index.html)
plots 22,204 locations across 18,878 cases — from the **County** field. She notes explicitly that
"the Subject field also contains more localised place names which I didn't use".

Those localised names are the interesting ones. *Great Easton*, *Dovercourt*, *Upminster*, *Barking*
— settlement-level geography, invisible on a county choropleth. Extracting them is easy to describe
and has historically been tedious to do: you need to find the names inside prose, decide which of the
world's many *Bostons* or *Richmonds* each one is, and keep every name tied to the record it came
from.

That is what the World Historical Gazetteer's forthcoming **Workbench** does, and this map is the
output of running it over county after county — 52 historic counties, some 18,500 catalogue entries.

## How it was made

Nothing here was hand-built. Every step is a feature of the Workbench, in the browser:

1. **Fetch the catalogue.** TNA's Discovery API is open and needs no key. Filtering REQ 2 to
   Elizabethan dates, then to entries whose `County` field names one historic county, gives between a
   handful (Cardiganshire: 5) and nine hundred (Essex: 913) records apiece.
2. **Reconcile the county.** The Workbench matches the *county* column against
   [UK Historic Counties](https://whgazetteer.org/), resolving every row in a county's set to a single
   polygon — `ukhc:ESE` for Essex, `ukhc:YRK` for Yorkshire, and so on.
3. **Read the prose, row by row.** A small language model running on WHG's own server reads the
   *Subject* and *Plaintiffs* fields of each record and returns the place names in them.
4. **Search inside the county.** Each row's names are looked up in WHG's index **constrained to that
   row's own county polygon**. This is the step that makes the result trustworthy, and it is worth
   dwelling on — see below.
5. **Explode to one row per mention.** The table is rebuilt with a row for each (record × field ×
   place), so every mention keeps its case reference, its date, and the field it came from.

The result is this map. The data files it reads are the Workbench's own output, unedited.

**Counties are visited in an order that jumps around the country** — a farthest-point traversal from
Essex, so each county read is the one furthest from everything read so far. The map therefore spreads
across England and Wales early rather than creeping outwards from one corner, and a partial sweep is
still representative.

## Why searching inside the county matters

A place name on its own is ambiguous, and historical corpora are full of names that also exist
elsewhere in the world. Searched globally, against a gazetteer covering 47 million places:

| name in an Essex case | unconstrained | constrained to `ukhc:ESE` |
|---|---|---|
| Dovercourt | a place in **Canada** | Dovercourt, Essex |
| Stratford | a place in **Australia** | Stratford, Essex |

The same constraint does something less obvious and more useful. A county polygon is a very effective
filter for **things that are not places at all**. The extractor is deliberately generous — it would
rather offer *Clement Wrighte* than miss *Great Easton* — and personal names are the commonest thing
it over-offers. But there is no place in Essex called *John Cowlande*, so the containment search
simply returns nothing, and the name falls away without anyone having to write a rule about surnames.

Names that match nothing are not discarded. They are flagged, because in this corpus roughly half of
them are **real places the gazetteer does not yet know** — *Honyngforde*, *Laybroke*, *Medesyde* —
and those are precisely the places a historian would want to contribute back.

## What the map shows

- **Each point is a place**, sized by how many cases mention it.
- **Colour distinguishes the role** the place plays, which is recoverable because each mention
  remembers the field it came from:
  - *disputed property* — named in the **Subject** field
  - *plaintiff's residence* — named in the **Plaintiffs** field
- **Clicking a place** lists the cases that mention it, each with its catalogue reference, date and
  short title, and a link to the full record in Discovery.

"Case mentions Upminster" is a weak fact. "A plaintiff of Upminster suing over land in Gaynes" is an
analysable one, and the difference is entirely in keeping track of which field each name came from.

## Autonomous, but not a black box

Everything on this map was produced without anyone intervening. The catalogue was fetched, the county
column reconciled, the prose read, the names searched inside their own county polygons and the table
rebuilt — end to end, unattended, across county after county. That is the claim being demonstrated,
and it is worth stating plainly rather than hedging.

What makes it usable rather than merely impressive is that the same pipeline stops for a person
wherever you want it to. The Workbench's reconciliation stage presents the rival candidates for each
row and takes a decision: pick one, accept more than one where a name really does denote two records,
reject a match outright, mark a row as having none, search by hand for something the index missed, or
record why you chose as you did. Decisions are made from the keyboard, and they survive a re-run of
the extraction, so intervening once does not mean intervening again.

Those are the levers a historian would reach for here. Which *Stratford*, where a county holds two.
Whether *Bloys* is a manor or a scribe's spelling of a surname. Whether the *Barking* that matched is
the right one, given it came back from a Trismegistos record. Whether an unmatched name like
*Honyngforde* is a real Essex place worth contributing to the gazetteer, or a misreading worth
rejecting. The Workbench's own output flags which rows invite the question — matched inside the
county, matched only outside it, or not matched at all — so the review is directed rather than
exhaustive.

None of it was needed to produce what you see. That is the difference between a process that can run
autonomously and one that must.

## Caveats

This is a demonstration, and it should be read as one.

- **Every match here was accepted automatically.** A small model reading early-modern legal abstracts
  gets most names and misses some, and nothing on this map has been confirmed by a person. Points are
  what the pipeline concluded unaided; the Workbench's review tools exist for when you want to settle
  the doubtful ones, and were not used.
- **Two fields, not all of them.** Only *Subject* and *Plaintiffs* are read. Defendants' residences —
  the other half of the litigants — are not here.
- **The sweep may be partly done.** The panel says how many counties have been read. Everything shown
  is complete for the counties listed; the rest are simply not there yet.
- **Coordinates are modern.** They come from matching against present-day and historical gazetteer
  records, so a point marks roughly where a named place is, not the extent of a manor or parish in
  1590.
- **Dates are the catalogue's.** Many REQ 2 entries are dated only to the reign, and appear here as
  the full range 1558–1603.
- **Counties themselves are not plotted.** A county is named in nearly every entry of its own set and
  resolves every time, so mapping it would put one enormous dot over the middle of it telling you what
  you already knew. It is the container of that subset, not a finding within it.

## Data

Three files, generated by `tools/build_data.py` from the Workbench's own output:

- `data/places.json` — every located place: name, WHG identifier, coordinates, county, and counts by
  role. This is all the map needs to draw, so it is loaded up front.
- `data/mentions/<County>.json` — the case references, dates, titles and context snippets behind
  those counts, fetched only when a popup opens.
- `data/progress.json` — which counties have been read, and the names that could not be located.

The split is deliberate rather than premature. The map needs coordinates and counts for thousands of
places; it needs case detail for the one place a reader clicks. Keeping them apart holds the first
paint to a few hundred kilobytes however far the sweep goes, and if the point count ever justifies
vector tiles it is a change of data format behind the same interface, not a rewrite.

Catalogue detail is embedded rather than fetched live. The Discovery API serves no
`Access-Control-Allow-Origin` header, so a static site cannot call it from the browser at all; each
case therefore carries its reference, date and short title in the data file, and links out to the
authoritative record in Discovery.

## Credits and licence

- Catalogue data: **The National Archives**, [Discovery](https://discovery.nationalarchives.gov.uk/),
  under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
- Place matching and coordinates: [World Historical Gazetteer](https://whgazetteer.org/).
- Basemap: [OpenFreeMap](https://openfreemap.org/) (Liberty), built from
  [OpenStreetMap](https://www.openstreetmap.org/copyright) data via
  [OpenMapTiles](https://www.openmaptiles.org/).
- Prompted by Sharon Howard's work on this series, and by Daniel Gosling's cataloguing of it.

Code in this repository is MIT-licensed. The derived data follows the licences of its sources.
