"""Fast page-marked text extraction for the recap pipeline.

Usage: python site/extract.py <input.pdf> <output.txt>

Uses pypdf (installed). Writes '=== Page N ===' markers so a reader can
jump to a slide range. Pages with under 20 characters are marked
[image-only] and their content is never guessed.
"""
import sys

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    sys.stderr.write("pypdf not installed: run python -m pip install pypdf\n")
    sys.exit(2)


def main():
    if len(sys.argv) != 3:
        sys.stderr.write("usage: extract.py <input.pdf> <output.txt>\n")
        sys.exit(2)
    src, out = sys.argv[1], sys.argv[2]
    reader = PdfReader(src)
    parts = []
    for i, page in enumerate(reader.pages, 1):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        if len(text.strip()) < 20:
            text = "[image-only]"
        parts.append("=== Page %d ===\n%s" % (i, text))
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("\n\n".join(parts))
    print("pages=%d" % len(reader.pages))


if __name__ == "__main__":
    main()
