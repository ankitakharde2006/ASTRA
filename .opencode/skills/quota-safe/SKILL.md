---
name: quota-safe
description: Keeps the recap pipeline inside the free-model daily limit — never retries a rate-limited spawn, generates the recap in-session when the quota blocks the run, and guarantees no rate-limit error is ever left on the website.
---

# Quota-safe recap

## When to use it

- `/status` or `output/server.log` shows `Rate limit exceeded: free-models-per-day`
- the user pastes that error into chat
- before spawning `opencode run` when the quota is already known to be exhausted

## Goal

The limit is never exceeded by blind retries, and a rate-limit error is never
left standing on the UI: the site must end up showing the recap for the
deck the user actually uploaded.

## Rules

1. **One spawn attempt per upload — never a retry loop.** A run that dies
   with the rate-limit error means the quota is dead; repeating `opencode run`
   only burns time and, if failures count, quota. Stop spawning.
2. **Generate in-session instead.** The assistant's own in-session requests
   keep working while spawned free-tier runs are blocked, so produce the
   recap directly: one pass, all five files, following `recap-style` and
   `.opencode/commands/recap.md` exactly. Never invent slide content.
3. **Recap only the current upload.** Read `output/.source.json` — every
   upload writes it after clearing `output/` — and generate for that file.
   Never present an older deck: the UI must not show already-generated data
   that does not belong to the latest upload.
4. **Verify the flip, do not restart anything.** Once the five files exist
   in `output/`, `GET /status` reconciles with disk (its `syncFromDisk()`
   runs while idle or after a failure) and reports `state: "done"` for the
   uploaded file. The page polls every 5 s while in error or idle state and
   swaps itself to the result — so the error view disappears on its own.
   Confirm `/status` is `done` and `/result` returns 200 before reporting.
5. **Extraction fallback.** The pdf-reader MCP may fail with
   `Please provide binary data as Uint8Array`. Fall back to Python
   `pypdf` (`python -m pip install pypdf`, already installed on this
   machine) or batch page ranges — do not abandon the run; note the
   fallback in `review.md`.
6. **Keep every run cheap so the limit is not hit again.** `RECAP_CMD`
   performs the quality review inline in the same turn (no reviewer
   sub-agent), asks for minimal tool calls, and the pipeline is single-pass
   with no review loops. Follow that shape whenever generating in-session
   too: extract once, write once, review once, stop.
7. **Escalation belongs to the user.** Only they can add $10 credits
   (1000 requests/day) or wait for the daily reset to re-enable spawned
   runs. State it once; the site's error view already shows the same
   guidance. Do not probe the API repeatedly.

## In-session generation checklist (single pass)

1. `output/.source.json` → the deck to recap (the latest upload).
2. Extract its text page by page (pypdf if the MCP is broken).
3. Apply `recap-style`: deck's own title, one-line overview, glossary the
   deck itself supports (6–16 entries with slide numbers), 5–8 topics
   spanning the whole deck with slide ranges and quoted examples, exactly
   3 exam takeaways, exactly 5 flashcards, one `flowchart TD` of at most
   12 nodes with only slide-stated edges, `closing` only if the deck has
   recap/next-up slides.
4. Review inline per `.opencode/agents/reviewer.md` in the same turn —
   verdict (`APPROVED` / `FIX NEEDED`) + coverage + one note per finding →
   `output/review.json` and `output/review.md`. Apply fixes once, no loops.
5. All five files exist → check `/status` reports `done`, `/result` 200,
   and the open page shows the new recap within its 5 s poll.
