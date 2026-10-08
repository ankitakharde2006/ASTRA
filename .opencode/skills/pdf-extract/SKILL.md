---
name: pdf-extract
description: Extract a PDF's text quickly and safely on this machine — load whenever a PDF must be read for the recap pipeline, before any summarizing starts.
---

# Skill: pdf-extract

## What works on this machine

| Method | When |
|---|---|
| `python site/extract.py <in.pdf> <out.txt>` | Fastest path — page-marked text via pypdf; the server already runs it on upload (`slides/<deck>.txt`) |
| A `.py` script using `pypdf` (`PdfReader(path).pages[i].extract_text()`) | Any custom extraction; `pypdf` is installed |
| **Never:** pdf-reader MCP (broken, Uint8Array error), `pdftotext`, `pdfinfo`, `tesseract` | Not installed — do not attempt |

## Rules

- **Write to files, not memory.** One loop script extracts every page to
  `output/work/pages/p-0001.txt` … — never one tool call per page, and never
  the whole PDF printed to the terminal.
- **Cap command output** (about 13 KB per read); read long decks in chunks of
  8–20 pages, once per chunk, never re-reading a chunk after its note exists.
- Pages with fewer than 20 characters are image-only: mark `[image-only]`
  and **never guess** their content.
- PowerShell is not Python: run Python from `.py` files or `python -c`, never
  inline Python syntax in PowerShell.
- The pipeline is resumable: before extracting, check which
  `output/work/pages/*.txt` already exist and continue from there.
