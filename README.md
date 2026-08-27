# Mapping the Elizabethan Court of Requests

An interactive map of the places named in **TNA REQ 2** — the pleadings of the Court of Requests,
c. 1558–1603 — for a single county, built end-to-end from an open catalogue with no bespoke code.

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
output of running it once, over one county.

## How it was made

Nothing here was hand-built. Every step is a feature of the Workbench, in the browser:

1. **Fetch the catalogue.** TNA's Discovery API is open and needs no key. Filtering REQ 2 to
   Elizabethan dates and to entries whose `County` field is exactly *Essex* gives 914 records.
2. **Reconcile the county.** The Workbench matches the *county* column against
   [UK Historic Counties](https://whgazetteer.org/), resolving all 914 rows to one polygon,
   `ukhc:ESE`.
3. **Read the prose, row by row.** A small language model running on WHG's own server reads the
   *Subject* and *Plaintiffs* fields of each record and returns the place names in them.
4. **Search inside the county.** Each row's names are looked up in WHG's index **constrained to that
   row's own county polygon**. This is the step that makes the result trustworthy, and it is worth
   dwelling on — see below.
5. **Explode to one row per mention.** The table is rebuilt with a row for each (record × field ×
   place), so every mention keeps its case reference, its date, and the field it came from.

The result is this map. The data file it reads is the Workbench's own output, unedited.

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

## Caveats

This is a demonstration, and it should be read as one.

- **The extraction is not authoritative.** A small model reading early-modern legal abstracts gets
  most names and misses some. Points on this map are candidates a researcher would review, not
  findings.
- **One county, two fields.** Only *Subject* and *Plaintiffs* were read. Defendants' residences —
  the other half of the litigants — are not here.
- **Coordinates are modern.** They come from matching against present-day and historical gazetteer
  records, so a point marks roughly where a named place is, not the extent of a manor or parish in
  1590.
- **Dates are the catalogue's.** Many REQ 2 entries are dated only to the reign, and appear here as
  the full range 1558–1603.
- **Essex itself is not plotted.** The county is named in nearly every entry and resolves every time,
  so mapping it would put one enormous dot over the middle of the county telling you what you already
  knew. It is the container of this dataset, not a finding within it.

## Data

`data/places.json` is generated by the Workbench and consumed directly by the map. Each entry carries
the place name, its WHG identifier and coordinates, and the mentions that produced it.

Catalogue detail is embedded rather than fetched live: the Discovery API sends no
`Access-Control-Allow-Origin` header, so a static site cannot call it from the browser. The map still
*attempts* a live request first and falls back to the embedded copy, so richer popups would appear
automatically if TNA ever enables cross-origin access. Every popup links out to the authoritative
record regardless.

## Credits and licence

- Catalogue data: **The National Archives**, [Discovery](https://discovery.nationalarchives.gov.uk/),
  under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
- Place matching and coordinates: [World Historical Gazetteer](https://whgazetteer.org/).
- Basemap: WHG's own tile service.
- Prompted by Sharon Howard's work on this series, and by Daniel Gosling's cataloguing of it.

Code in this repository is MIT-licensed. The derived data follows the licences of its sources.
