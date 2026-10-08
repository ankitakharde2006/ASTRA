# AGENTS.md — Course Recap project

Instructions for every agent working in this repository, including the
non-interactive `opencode run` children spawned by `site/server.js`.

## Environment facts — do not re-discover these

- Windows + PowerShell. `pdftotext`, `pdfinfo` and `tesseract` are **not**
  installed. The pdf-reader MCP is broken (Uint8Array error) — never call it.
- Python is on PATH as `python`; `pypdf` is installed.
- Extract PDFs with `python site/extract.py <in.pdf> <out.txt>` (page-marked
  text). The server already runs this on upload and puts the file at
  `slides/<deck>.txt` — read that file when it exists.
- Never run Python syntax inline in PowerShell (it parses as PowerShell and
  fails). Write a `.py` file, or use `python -c` with a one-liner.
- Never delete anything outside `output/`.

## Fast lane for recap runs (quota-safe)

The free-model daily quota is tiny — no environment probing, no version
checks, no exploring beyond the deck and the output files.

1. Read `slides/<deck>.txt` (or extract with `site/extract.py` first).
2. Follow `.opencode/skills/recap-style/SKILL.md` and write
   `output/recap.json`, `output/recap.md`, `output/diagram.mmd` —
   one pass, content only from the deck, slide numbers on every claim.
3. Review once against the extracted text, apply fixes once, write
   `output/review.json`.
4. Stop when the five output files exist on disk.
