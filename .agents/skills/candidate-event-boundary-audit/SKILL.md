---
name: candidate-event-boundary-audit
description: Audit page ranges and scene boundaries for literary emotion-learning candidate events when adjacent events share pages, spans cross scene transitions, or an event summary may include neighboring narrative material.
metadata:
  short-description: Audit candidate event boundaries
---

# Candidate Event Boundary Audit

Use this skill when source-reviewing candidate events in this project and a page range may include an adjacent scene or omit part of its own event.

## Workflow

For chapter batches, use `candidate-batch-count-reconciliation` to reconcile the declared count with unique IDs and the progress/index span before source review.

1. Read the candidate and the immediately preceding and following candidates from the batch, progress file, and unified index. Compare their characters, actions, and page intersections.
2. Inspect every cited source page around the event start and end. Map each clause in the summary to the supporting passage; include the first page when it contains the stated trigger or opening contrast, include the page containing the final response or outcome, and exclude pages after the event ends. Mark exact actions and check changes in scene, time, focal character, or information source.
3. Keep only pages that support the candidate's described focus. A shared page is valid when it contains distinct evidence for both events; state the transition and do not treat the events as duplicates. If a page is included only because it is adjacent, narrow the range. Preserve non-contiguous ranges only when each segment supports the same event.
4. Use `candidate-character-scope-audit` to check event-level participants. Check that the summary does not absorb nearby characters, actions, or reactions; separate explicit narration, dialogue, reported speech, and interpretation.
5. Synchronize any verified correction across the source batch, progress JSON, unified index (including nested source record), and audit report. Recheck that IDs, page ranges, and sample counts agree.
6. If an actual error was corrected, record it in both project error-ledger files and run `python .agents/skills/project-error-ledger/scripts/check_ledger.py`. Follow that skill’s recurrence and escalation rules.

Do not force adjacent events into one event solely because they share a PDF page. Do not claim a range is verified from its first and last pages alone; inspect the intervening pages and the transition beyond each boundary, including the first paragraph on the next page after a candidate ends.
