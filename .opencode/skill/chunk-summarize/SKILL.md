---
name: chunk-summarize
description: Map-reduce summarization of long documents in small chunks saved to files, so context never fills up.
---
- Chunk about 8 pages (about 5000 words max); write one small JSON note per chunk, then never reread that chunk.
- Reduce by reading only the notes; with over 40 chunks merge in groups of 10 first.
- Keep it resumable: skip chunks whose note file already exists.
- Use only facts from the PDF; leave examples empty if none exist.
