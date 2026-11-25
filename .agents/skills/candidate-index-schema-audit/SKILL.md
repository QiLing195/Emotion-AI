---
name: candidate-index-schema-audit
description: Audit and synchronize the normalized cross-work candidate-event JSONL schema when source batches or progress records change.
metadata:
  short-description: Validate unified candidate index structure
---

# Candidate Index Schema Audit

Use this when adding or correcting candidate events in `cross-work-candidate-events-v2.jsonl`, especially when page spans, participants, source fields or nested records change. The authoritative mapping is documented in `artifacts/emotion-learning/cross-work-schema-audit-v2.md`.

## Invariants

- Keep the normalized top-level schema distinct from the embedded source shape: normalized field names follow the schema (for example `possible_need_or_conflict`), while `source_record` preserves the source record’s field names and values.
- `pdf_page_ranges` is a list of inclusive `[start, end]` pairs. A one-page span is `[[p, p]]`; non-contiguous spans use one pair per segment. Do not emit a flat `[start, end]` or one-element `[[p]]`.
- `source_location_original` preserves the original source field name and raw value. When an audit corrects a page span, update the normalized ranges and corrected source record while retaining that original value for traceability.
- Preserve unrelated metadata, empty annotation fields and candidate-only status. Do not add normalized fields copied from batch Markdown when they are absent from the schema.

## Workflow

1. Read a neighboring normalized record and the schema audit; inspect both top-level normalized fields and nested `source_record`.
2. Compare the target event against its progress/source record. Synchronize the corrected chapter, page ranges, participants, trigger, observations and interpretation in the intended normalized locations. Preserve `source_location_original`.
3. Validate the complete work-specific ID set for uniqueness and parity. Compare every applicable progress field with its normalized and nested counterpart. Parse each page string, including discontinuous segments, and verify `pdf_page_ranges` has the required pair-of-integers structure.
4. Confirm no extra top-level keys or unintended changes to other works. Run project ledger validation after recording a real schema error.
