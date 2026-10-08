---
name: pdf-ingest
description: Accept any PDF the user provides, move it into the project, and run the whole recap pipeline on it — extraction, topic summaries, review, diagram, website. Use whenever a user uploads, drops, attaches, or names a PDF to summarize.
---

# PDF ingest — any deck in, recap out

Takes a PDF from wherever the user hands it over and carries it all the way
through: into the project's own files, through the recap pipeline, and onto
the study website. The website upload does steps 1–3 automatically; follow
this skill when a PDF arrives any other way (chat attachment, a path, a drag
onto the terminal).

## Steps

### 1. Accept any deck, any name

Never reject a PDF because of its filename or where it came from. Work out a
bare name the project accepts:

- lowercase is fine, spaces and odd characters become `-`
- must start with a letter or digit and end in `.pdf`
  (pattern `^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$`)
- unicode or empty stems fall back to `deck.pdf`
- example: `My Lecture (final).PDF` → `my-lecture-final.pdf`

### 2. Move it into place

Copy or move the file to `slides/<name>.pdf` — that is the project's home for
input decks (`slides/` is never served over HTTP). Confirm the first five
bytes are `%PDF-`; if the file is not actually a PDF, say so plainly instead
of running the pipeline on it. One deck per run; decks up to 300 MB are
accepted (`MAX_UPLOAD_MB` on the server).

### 3. Run the recap pipeline for that file

Invoke the `/recap` command with the deck's path (`/recap slides/<name>.pdf`):

1. extract text page by page with `pdf-reader.read_pdf` (batches of ~20 pages
   for long decks; fall back to `pdfjs-dist` if the MCP fails),
2. follow the `recap-style` skill and write `output/recap.md`,
   `output/diagram.mmd` and `output/recap.json` (topics, takeaways,
   flashcards, glossary, diagram),
3. review once against the slides, apply fixes once, then stop,
4. write `output/review.json` and `output/review.md`.

The website upload path already does this: `POST /upload` streams the file to
`slides/<name>.pdf`, clears `output/`, and spawns the same pipeline.

### 4. Report what exists

List the output files that are actually on disk and say where the site picks
it up (`GET /result` renders it at `http://localhost:3000`).

## Rules

- **Never invent slide content** — every claim cites a slide number.
- `output/` is regenerated on every run (except `server.log`); the deck you
  just moved into `slides/` is the only input.
- If OpenCode's quota blocks the run, report the server's `lastError` from
  `GET /status` — do not fabricate results.
