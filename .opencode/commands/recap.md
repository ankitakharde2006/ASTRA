---
description: "Course Recap Generator - Single pass processing pipeline"
---

# Course Recap Generator

## Overview

Generates comprehensive course recaps from PDF slide decks using OpenCode's integrated pipeline. This command runs a single, complete pass that:

1. Extracts content from the specified PDF slides
2. Generates thematic topic summaries, structured JSON and concept diagrams
3. Applies quality review and corrections
4. Records the reviewer verdict and coverage score
5. Feeds a polished HTML website for study and reference

## Usage

```bash
/recap <path-to-pdf>
```

Replace `<path-to-pdf>` with the path to your slide deck PDF file (e.g., `slides/day.pdf`).

## Process Flow

### Step 1: PDF Content Extraction

**Command:** `pdf-reader.read_pdf`

Uses the configured pdf-reader MCP server to extract slide content:

- Extracts text from the specified PDF pages
- Preserves structure and formatting
- Captures all key concepts and relationships

**Long decks:** read the PDF in batches of about 20 pages at a time (the
`read_pdf` `pages` parameter takes a page or range per source, e.g. pages
`1-20`, then `21-40`, and so on), then merge the extracted text into one
body before analysing. This is still a single run — one extraction pass
into one recap, with no review loops.

If the MCP server fails, fall back to extracting text with `pdfjs-dist` and continue — do not abandon the run. Note the fallback in the final summary.

**Output:** Raw slide text content with page metadata

### Step 2: Recap Generation

**Skill:** `recap-style`

Applies the recap-style skill to transform extracted content:

- Title and one-line overview
- Extracts a glossary of the terms the deck itself defines, each with its slide number(s) — definitions only from the slides, never from outside knowledge
- Groups slides into 5-8 thematic topics, each with a slide range, a 1-2 sentence explanation and an example from the slides
- Produces 3 key exam takeaways
- Builds Mermaid `flowchart TD` diagram (max 12 nodes, edges only where slides state the relationship)

Write all three files:

- `output/recap.md` - Human-readable recap: topic summaries, slide examples, takeaways
- `output/diagram.mmd` - Bare Mermaid source, no code fence, no prose
- `output/recap.json` - Machine-readable recap in the exact shape the skill specifies: `title`, `overview`, `glossary[]` (`term`, `definition`, `slides`), `topics[]` (`name`, `slides`, `summary`, `example`), `takeaways[]` (3), `flashcards[]` (5, each `q`/`a`), `diagram`, and `closing` when the deck has recap/next-up/appendix slides

The three files must agree. A concept in `recap.md` but missing from `recap.json`, or a diagram in `recap.json` that differs from `diagram.mmd`, is an error to fix before step 3.

### Step 3: Quality Review

**Agent:** `@reviewer`

Call the reviewer agent with the agent tool and **wait for its result in this same turn**. This is a synchronous tool call — do **not** launch it as a background session: `opencode run` is non-interactive, so background notifications never arrive and the run would end before the review finishes.

Pass the extracted slide text plus all three generated files:

- Compares summary content against original slides
- Validates diagram edges against slide relationships
- Checks for missed key concepts or misrepresentations
- Checks that the topics span the whole deck
- Returns `VERDICT: <APPROVED|FIX NEEDED> | COVERAGE: <number>` on its first line, then bullet fixes

**Input:** Slide text + recap.md + recap.json + diagram.mmd

If the agent tool call fails, perform the review yourself using these same rules, and record in the notes that the sub-agent was unavailable.

### Step 4: Single-Pass Correction

**Action:** Apply fixes once, then stop.

If the reviewer returns `FIX NEEDED`:

- Implement every bullet-point correction
- Update `recap.md`, `recap.json` and `diagram.mmd` together, keeping them consistent
- Do **not** re-run the reviewer. One review, one correction pass, no loops.

### Step 5: Final Verdict

Record the reviewer's verdict and coverage score in both files, **immediately and in this same turn** — do not end your turn while any output file is still missing.

**Output:** `output/review.json`

Exact shape:

```json
{ "verdict": "", "coverage": 0, "notes": [""] }
```

- `verdict` - `APPROVED` or `FIX NEEDED`, taken verbatim from the reviewer's `VERDICT:` line
- `coverage` - integer 0-100, taken from the reviewer's `COVERAGE:` value
- `notes` - one string per reviewer bullet, plus a line recording which fixes from step 4 were applied

**Output:** `output/review.md`

Human-readable companion: the same verdict and coverage, the reviewer's findings, and the list of fixes applied.

Do not recompute or adjust either value. If the reviewer omitted the coverage score, record `0` and note the omission rather than estimating a score yourself.

**Your turn is not finished until all five files exist on disk:** `output/recap.md`, `output/diagram.mmd`, `output/recap.json`, `output/review.json` and `output/review.md`. If unsure, list `output/` before ending your turn.

## Files Generated

1. **`output/recap.md`** - Complete topic summaries
2. **`output/recap.json`** - Structured recap: glossary, topics, takeaways, flashcards, diagram
3. **`output/diagram.mmd`** - Mermaid concept diagram
4. **`output/review.json`** - Verdict, coverage score, notes
5. **`output/review.md`** - Human-readable review detail

The website is not generated by this command. `site/` is a fixed frontend that renders `GET /result` (recap.json merged with review.json) for whatever deck was uploaded.

## Quality Assurance

The single-pass approach ensures:

- **Accuracy:** All content is verified against source slides
- **Completeness:** Coverage score reports what share of key concepts the recap reaches
- **Consistency:** `recap.md`, `recap.json` and `diagram.mmd` describe the same recap
- **Efficiency:** One complete processing cycle, no review loops

## Example Workflow

```bash
/recap slides/day.pdf

# Generates:
# output/recap.md          # Topic summaries
# output/recap.json        # Structured recap
# output/diagram.mmd       # Concept diagram
# output/review.json       # Verdict + coverage score
# output/review.md         # Review detail
```

## Notes

- This command processes exactly one PDF per execution
- Never invent slide content; if a topic has no example in the slides, record `None in slides`
- Deck recap, next-up and appendix slides go in a closing section of `recap.md`, not in `topics` or the diagram
- Commands can be customized by modifying the skill and agent configurations

## Troubleshooting

If the command fails:

1. Verify the PDF path is correct
2. Check that the pdf-reader MCP server is enabled
3. Ensure adequate disk space for temporary files
4. Review output directories for error messages
5. If the reviewer returns no `COVERAGE` value, record `0` in `review.json` and note it

This single-pass pipeline is designed for efficiency and quality, providing a complete course recap solution in one execution.