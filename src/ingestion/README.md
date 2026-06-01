# `src/ingestion` — Layer 1: messy data in, clean readings out

Turns the variety of real-world C&I data into validated, normalised readings the core can
trust. v1 handles **NEM12** files (drag-and-drop upload, all channels E/B/Q). Bill data is
captured via a **structured entry form** in v1, not parsed from PDF (see CLAUDE.md §6).

- `parsers/` — one adapter per format. NEM12 first. Each parser's job is format → normalised
  `IntervalReading`s, nothing more.
- `validators/` — quality checks and gap detection. Assume messy data: carry NEM12 quality
  flags through, and flag gaps/estimates rather than hiding them.

The original uploaded file is always retained (Supabase Storage) so we can re-parse from
source. Every upload gets an import-batch audit record.
