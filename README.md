# Course Recap Generator

Turns a slide-deck PDF into a per-topic recap, a Mermaid concept diagram, and a polished study website — in one OpenCode pass. Upload any PDF through the website and the pipeline builds the recap for it.

## What it does

Input: any slide-deck PDF (this example uses `slides/day.pdf`) → output:

| File | Contents |
|---|---|
| `output/recap.md` | 8 thematic topics with slide ranges, 1–2 sentence explanations, one slide example each, 3 exam takeaways, a 16-term glossary, deck closing with the flagged gap |
| `output/recap.json` | Machine-readable recap: glossary, 5–8 topics with slide ranges, 3 exam takeaways, 5 flashcards, diagram, closing |
| `output/diagram.mmd` | Mermaid `flowchart TD`, ≤12 nodes, edges only where slides state the relationship |
| `output/review.json` | Machine-readable verdict: `verdict`, `coverage`, `notes` — merged into `GET /result` for the site's review badge |
| `output/review.md` | Reviewer verdict: `APPROVED` or `FIX NEEDED` + findings + fixes applied |
| `site/index.html` + `style.css` + `script.js` | Upload-driven website: dropzone → stepper/progress/cancel → rendered recap (gradient hero, card grid, dark/light toggle, responsive, print-friendly), all content from `GET /result` |

## Planning choices (from PLAN.md — saved at `C:\Users\ANKITA\.opencode\plan`)

**Per-topic summaries, not per-slide or whole-deck.** Per-slide kept slide-level precision but produced repetitive, thematically incoherent notes — too granular for revision. Whole-deck gave a quick overview but diluted content and made targeted takeaways impossible. Grouping related slides into 5–8 themes keeps a slide range for traceability while reading as coherent study material.

**Mermaid `flowchart TD`, not concept map or hierarchy.** A concept map's bidirectional relations blew past the 12-node budget and read poorly as a simple flowchart. A hierarchy diagram implied importance levels that the slides never asserted. A top-down flow matches how a request actually progresses, and keeps the diagram to one glanceable picture.

**Single pass, no loops.** The reviewer checks once and its fixes are applied once, then the run stops. Cheaper in credits, and it matches a review gate rather than an auto-repair loop.

## The MCP server: `pdf-reader`

Configured in `opencode.json` as a local server running `npx -y @sylphlab/pdf-reader-mcp` (Windows wrapper `["cmd","/c",...]`), enabled at startup. It turns the deck's PDF pages into text so the recap is written from real slide content rather than guessed.

⚠️ **Known issue:** that package currently fails with `Please provide binary data as 'Uint8Array', rather than 'Buffer'`. The example run worked around it by extracting text with `pdfjs-dist` directly. Fix or pin the package version before relying on it.

## The reviewer sub-agent: `.opencode/agents/reviewer.md`

Runs as a `subagent` with `write`/`edit`/`bash` all false — it can only read and answer, never change files. It compares the slide text against the recap and diagram, and reports three things:

- **missed key concepts** — important slide content absent from the recap
- **misrepresented or invented content** — claims the slides don't support
- **diagram edges not supported** — connections the slides never state

It replies `APPROVED` or `FIX NEEDED` with short bullet fixes. If the agent tool call fails, the command has the run perform the same review inline and record that the sub-agent was unavailable — which is what happened in the example run below.

## The recap-style skill: `.opencode/skills/recap-style/SKILL.md`

Standardises the output shape so every recap reads the same: a title and one-line overview; a glossary of the terms the deck itself defines (each cited to its slides — never a dictionary definition); 5–8 topics grouped by content theme (never per slide), each with a slide range, a 1–2 sentence explanation and an example from the slides; 3 exam takeaways; 5 flashcards; one Mermaid `flowchart TD` with at most 12 nodes whose edges are only relationships the slides state; and a short closing note for the deck's recap/next-up/appendix slides. It also carries the hard rule: **use only slide content, never invent facts.**

## The pdf-ingest skill: `.opencode/skills/pdf-ingest/SKILL.md`

Takes any PDF the user hands over — any name, any location — works out a name the project accepts, moves it into `slides/`, verifies the `%PDF-` header, then drives the whole pipeline (extract → recap → review → diagram) for that deck. The website upload performs the same steps server-side; the skill covers every other way a PDF arrives (chat attachment, a path, drag onto the terminal).

## The quota-safe skill: `.opencode/skills/quota-safe/SKILL.md`

Keeps the pipeline inside the free-model daily limit and makes sure a rate-limit failure never ends up as a dead error on the screen: one spawn attempt per upload and no retry loops; when the quota blocks the run, the recap is generated in-session in a single pass (same `recap-style` shape, inline review, pypdf fallback if the pdf-reader MCP fails); only the file in `output/.source.json` — the latest upload — is ever recapped, so the UI never shows an older deck; and once the five files exist, the server's `syncFromDisk()` plus the page's 5-second error/idle poll swap the view to the result by themselves.

## Run it

Start the server once, then use the website:

```bash
node site/server.js        # or: npm run site — or double-click start-server.cmd
```

Open `http://localhost:3000`, drop a PDF into the upload zone, and watch the stepper (read → summarize → review → diagram) until the recap site renders. `POST /upload?name=<file>.pdf` accepts any deck; `GET /result` returns the recap JSON the page renders. The result hero has a **Download recap** menu (Markdown, JSON, diagram, review notes, Print/Save as PDF) next to *Summarize another PDF*, and a floating moon/sun button (bottom-right, built from the same surface/accent colors as every other control) switches dark ↔ light — remembered in `localStorage`.

The page also works when you double-click `site/index.html` directly: API calls then go to `http://localhost:3000` with CORS enabled, so as long as the server is running, uploading and rendering behave exactly the same.

**Free-quota failures:** the spawned run needs OpenCode model requests. If it dies with `Rate limit exceeded: free-models-per-day`, the site shows that message plus guidance — add credits ($10 → 1000 requests/day), wait for the daily reset, or have the assistant generate the recap in-session (the `quota-safe` skill is exactly that procedure). The error never sticks: `output/.source.json` records which deck the five files belong to, the server's `syncFromDisk()` reports `done` for that upload as soon as the files exist, and the page — which keeps polling every 5 seconds while idle or in error — swaps itself to the result. The site only ever shows the recap of the latest upload; opening it fresh never replays an older deck. `RECAP_CMD` performs the review inline instead of spawning the reviewer sub-agent, roughly halving the requests a run needs.

The pipeline itself is defined in `.opencode/commands/recap.md`: extract text page by page via `pdf-reader.read_pdf` → follow `recap-style`, writing `output/recap.md` + `output/diagram.mmd` + `output/recap.json` → call `@reviewer` with the slide text and both files → apply fixes once, then stop → save the verdict to `output/review.json` and `output/review.md`.

## Example run

Deck: *Inference Basics*, Day 4 · ASTRA, deboistech, 2026-10-04, 28 slides.

Extraction → 8 topics over slides 1–25 (closing slides 26–28 kept as appendix): framing 1–3 · vocabulary 4–5 · six-stage pipeline 6–10 · KV cache + latency formulas 11–14 · batching & scheduling 13, 15–16 · cost-latency trade-offs & routing 17–19 · monitoring & symptom triage 20, 25 · failures at scale 21–24 — plus a 16-term glossary and 5 flashcards. Diagram: 12 nodes, 15 edges, all traced to slide text.

Reviewer verdict: **FIX NEEDED**, coverage 94 (the reviewer sub-agent couldn't be spawned, so the command's inline self-review ran) — no misrepresentations, no unsupported diagram edges. Three fixes applied once, all on Topic 8:

- slide 21: case 1 named — GPT-2/3's tokenizer and the Reddit r/counting usernames such as 'SolidGoldMagikarp'
- slide 22: case 2's stated facts added — GPT-4o launched May 2024 with a new 200k-token tokenizer
- slide 23: mechanism added — short-context requests sent to servers set up for the 1M-token context window, sticky routing keeping some users on the wrong servers

The site renders whatever `GET /result` returns for the uploaded deck. Mermaid loads from cdnjs, so the diagram needs internet; everything else works offline.
