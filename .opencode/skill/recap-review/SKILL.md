---
name: recap-review
description: Review a generated recap against chunk notes and spot-checked pages, then score coverage.
---
- Compare recap.json to the chunk notes; spot-check 5 random pages in output/work/pages.
- coverage = pages inside topic slide ranges / total pages, as 0-100.
- Fix wrong or missing items once, then write output/review.json with verdict pass, revise or fail, plus short notes.
- Validate JSON with `python3 -m json.tool`.
