---
description: Summarize ONE user-provided PDF into output/recap.json and output/review.json
---
Input: `$ARGUMENTS` is the path to the PDF to summarize (example: slides/lecture.pdf).
Use ONLY this PDF. Ignore every other file in slides/ and any older file in output/. Never invent content that is not in the PDF. Nothing may be hardcoded: every title, topic, example and card must come from this PDF.

## Skills
Load these when you reach the matching phase (if skills are unavailable, just follow the steps below): `pdf-extract` (Phase 1), `chunk-summarize` (Phases 2 and 3), `mermaid-diagram` (Phase 4), `recap-review` (Phase 5).

## Hard rules (these prevent context and size limits)
- NEVER open or read the whole PDF at once. Work in small chunks and keep results in files, not in your memory.
- NEVER print long text to the terminal. Cap any command output (`| head -c 3000`).
- Be resumable: before each phase, check which files already exist in output/work and continue from there instead of starting over.
- If a command fails, read the error, fix it, and retry (different tool, smaller chunk). Do not stop and do not ask me anything. If it is truly impossible, write the reason to output/error.txt and stop.

## Phase 0: Setup
1. `rm -rf output && mkdir -p output/work/pages`
2. Count pages: `pdfinfo "$ARGUMENTS"` (fallback: python3 with pypdf or PyMuPDF). Save the number as N.

## Phase 1: Extract text page by page
- For each page i in 1..N: `pdftotext -layout -f i -l i "$ARGUMENTS" output/work/pages/p-iii.txt` (fallback: python with pypdf or PyMuPDF). Do it in one loop script, not one tool call per page.
- If a page has fewer than 20 characters, it is image-only: try `tesseract` OCR if installed, otherwise mark it `[image-only]` and do not guess its content.

## Phase 2: Map (chunk notes)
- Group pages into chunks of about 8 pages (maximum about 5000 words). For slide decks with little text use 12 pages.
- For each chunk, read ONLY that chunk's page files, then write `output/work/chunk-NN.json`:
  `{"pages":[start,end],"topic":"","summary":"max 70 words","key_terms":[],"points":["max 5"],"examples":[{"title":"","problem":"","solution":""}],"diagram_hint":""}`
- Examples must be real worked examples, cases or numbers found in the pages. Leave the list empty if there are none.
- After writing the file, do not look at that chunk's text again.

## Phase 3: Reduce
- Read ONLY the chunk-NN.json files (they are small). If there are more than 40 chunks, first merge groups of 10 into `group-NN.json`, then merge those.
- Merge neighbouring chunks about the same subject into one topic with a slide range. Maximum 12 topics.

## Phase 4: Write output/recap.json
```
{
 "source": "<pdf file name>",
 "pages": N,
 "topics": [{"title":"","slides":"3-9","summary":"","points":[""]}],
 "takeaways": ["8 to 15 exam-focused one-liners"],
 "diagram": "valid Mermaid code",
 "examples": [{"title":"","slides":"","problem":"","solution":""}],
 "flashcards": [{"q":"","a":""}]
}
```
- 10 to 25 flashcards, 3 to 6 examples (taken from the PDF), takeaways ordered by exam importance.
- Mermaid: start with `flowchart TD`, at most 25 nodes, ids letters/numbers only, every label in double quotes, no raw parentheses or colons outside quotes. Show how the main topics connect.

## Phase 5: Review (use notes, not the whole PDF)
- Compare recap.json with the chunk notes. Spot-check 5 random pages against output/work/pages.
- coverage = pages inside topic slide ranges / N, as a number from 0 to 100.
- Fix any wrong or missing item once, then write output/review.json:
  `{"verdict":"pass|revise|fail","coverage":0,"notes":["short issues or confirmations"]}`

## Phase 6: Finish
- Validate both files with `python3 -m json.tool`. Fix and rewrite if invalid.
- `rm -rf output/work`
- Reply with one line only: `DONE <topics> topics, <flashcards> flashcards, coverage <n>%`
