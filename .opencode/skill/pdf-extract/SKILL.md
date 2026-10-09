---
name: pdf-extract
description: Extract text from a PDF of any size one page at a time, with OCR fallback, without loading the whole file.
---
- Count pages with `pdfinfo file.pdf`; fallback: python3 pypdf or PyMuPDF.
- One loop script writes each page to output/work/pages/p-NNNN.txt using `pdftotext -layout -f i -l i`.
- Pages under 20 characters are image-only: run `tesseract` if installed, else mark `[image-only]`.
- Never cat whole files; cap output with `head -c 3000`.
