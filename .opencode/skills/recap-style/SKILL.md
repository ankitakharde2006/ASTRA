---
name: recap-style
description: Skill for generating consistent course recaps with thematic topic summaries, exam takeaways, and Mermaid flow diagrams based on slide content.
---

# Course Recap Generator Skill

## Overview

Generates structured course recaps with thematic topic summaries, exam takeaways, and Mermaid flow diagrams extracted directly from slide content.

**Hard rule: use only slide content. Never invent facts, numbers, examples, or relationships.** If the slides do not state something, it does not go in the recap. If a topic has no example in the slides, write `None in slides` rather than manufacturing one.

## Output files

Write all three on every run:

| File | Contents |
|---|---|
| `output/recap.md` | Human-readable recap (same content as the JSON) |
| `output/diagram.mmd` | Bare Mermaid `flowchart TD` source, no code fence, no prose |
| `output/recap.json` | Machine-readable recap, exact shape below |

**Long decks:** extract the slide text in batches of about 20 pages
(the pdf-reader MCP accepts a page range per source), then merge the
batches into one body before grouping into topics. One pass, one
recap — no loops.

## Required shape

### Title and overview

- A **title** — the deck's own title, not a rephrasing
- A **one-line overview** — what the session covers

### Glossary

A **glossary** of the terms the deck itself defines — typically 6–16 entries.
Every definition must come from the slides and carry its slide number(s).
If the slides use a term without ever defining it, either leave the term out
or define it only from how the slides use it — never import a dictionary
definition. Write the same glossary as a `## Glossary` section in `recap.md`.

### 5–8 key concepts, grouped by topic

**Never one card per slide.** Group related slides into themes and keep the slide range so the summary stays traceable.

- **5–8 topics**, ordered as the slides run
- Together the topics must **span the whole deck** — every teaching slide belongs to some topic's range. A recap that stops halfway through the deck is incomplete.
- Each topic carries a **slide range** like `slides 3-7` (a single slide is fine: `slides 12`; non-contiguous is fine: `slides 20, 25`)
- A **1–2 sentence explanation** — what the topic is and why it is in the deck
- **One example from the slides**, quoted or closely paraphrased, with its slide number. If none exists, write `None in slides`

### 3 exam takeaways

Exactly three. Each is the thing a student must be able to reproduce from memory — a formula, a trade-off, a number the deck states. Not a topic restated.

### One Mermaid `flowchart TD` diagram

- **At most 12 nodes.** Exceeding it means merging topics, not dropping relationships.
- **Short labels** — a few words per node; put detail in `recap.md`, not in the diagram.
- **Edges only for relationships the slides state.** If no slide says A causes or precedes B, there is no arrow. Dangling nodes without a stated relationship should be left out rather than invented into the graph.
- Mirror the deck's own ordering where the slides give one (e.g. an explicit stage order).

## `output/recap.json`

Exactly these keys, no extras, no omissions:

```json
{
  "title": "",
  "overview": "",
  "glossary": [
    { "term": "", "definition": "", "slides": "" }
  ],
  "topics": [
    { "name": "", "slides": "3-7", "summary": "", "example": "" }
  ],
  "takeaways": ["", "", ""],
  "flashcards": [
    { "q": "", "a": "" }
  ],
  "diagram": "flowchart TD\n  A[...] --> B[...]",
  "closing": ""
}
```

Field rules:

- `title` — deck title
- `overview` — one line
- `glossary` — 6–16 objects, each with exactly `term`, `definition`, `slides`; every definition stated in the slides
- `topics` — 5–8 objects, each with exactly `name`, `slides`, `summary`, `example`
- `takeaways` — exactly 3 strings
- `flashcards` — exactly 5 objects, each with exactly `q` and `a`
- `diagram` — the Mermaid source as a single string; `\n` escapes are fine, no markdown fence
- `closing` — optional; a short string covering the deck's recap/next-up/appendix slides and any flagged gap. Omit the key entirely when the deck has none.
- `slides` uses the same notation as the prose recap, e.g. `3-7`, `12`, `20, 25`

Flashcard rules: each `q` is a single exam-style question whose answer is stated in the slides (definitions, formulas, numbers, trade-offs). Each `a` is the answer, not a hint. Do not invent a question the slides cannot answer.

## Deck closing

Slide-deck recaps for a course series often end with recap/next-up/appendix slides rather than teaching content. Do not force them into a topic. Note them in a short closing section of `recap.md`, and leave them out of `topics` and the diagram. If the deck's own recap slide names a concept that has no dedicated slide (e.g. "sharding"), flag that gap explicitly rather than inventing content to cover it.

## Worked example

Real output for *Inference Basics* (Day 4 · ASTRA, 28 slides) — slides 1–25 became 8 topics, slides 26–28 went to the closing section:

| Topic | Slides |
|---|---|
| From "send" to "response" | 1–3 |
| Vocabulary, deepened | 4–5 |
| The six-stage inference pipeline | 6–10 |
| KV cache and the latency formulas | 11–14 |
| Batching strategies and scheduling | 13, 15–16 |
| Cost-latency trade-offs and routing | 17–19 |
| Monitoring and symptom triage | 20, 25 |
| Failures at scale: four cases | 21–24 |

The diagram used exactly 12 nodes — the ceiling — and every edge traced to a stated relationship: `TTFT = queueing + prefill` (slide 14) gives two arrows into TTFT, `TPOT = decode time per token` gives decode → TPOT, and `TTFT + (output tokens - 1) x TPOT` gives both metrics into total latency.

Case-study numbers carried their sources because the deck's appendix insists on it. Slide 28 states the figures are "as reported by their authors, and they are not independently verified" — that caveat travels with the recap rather than being dropped.