# Error case record template

Use this field set in `artifacts/project-error-ledger.jsonl`:

```json
{
  "case_id": "PE-0001",
  "date": "YYYY-MM-DD",
  "project_area": "...",
  "category": "scope|source-grounding|data-integrity|validation|workflow|other",
  "failure_mode_key": "short-stable-key",
  "summary": "One sentence describing the actual failure.",
  "wrong": {"what": "...", "where": "..."},
  "cause": {"confirmed": "...", "hypothesis": null},
  "correct": {"method": "...", "result": "..."},
  "detection_and_fix": "...",
  "prevention_check": "...",
  "occurrence": 1,
  "recurrence_threshold": 3,
  "status": "caught_before_delivery|corrected",
  "dedicated_skill": null
}
```

The Markdown ledger is the readable view; JSONL is the canonical machine-countable record. Keep their IDs, failure-mode keys, occurrence counts, and escalation status synchronized.
