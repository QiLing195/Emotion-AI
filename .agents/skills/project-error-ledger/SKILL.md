---
name: project-error-ledger
description: Record and prevent recurring mistakes in this project. Use after a factual, reasoning, implementation, validation, or workflow error is found and corrected; compare what went wrong with the verified correct method, track recurrence, and create a focused skill when a failure mode repeats.
metadata:
  short-description: Record project errors and prevent recurrence
---

# Project error ledger

When work in this repository reveals an actual error, add a concise case to `artifacts/project-error-ledger.md` and a structured record to `artifacts/project-error-ledger.jsonl`. Do this as part of fixing the error; do not wait for the user to request a postmortem.

## Record each case

Capture:

- a stable case ID, date, task/artifact, and error category;
- what was wrong and where it appeared;
- the verified cause, separating confirmed cause from hypothesis;
- the correct method/result beside the mistaken method/result;
- how the error was detected and what correction was made;
- a short prevention check usable on future work;
- a failure-mode key and its confirmed recurrence count.

Do not log ordinary uncertainty, user preference changes, harmless style differences, or an error that was only hypothetical. If the error is caught before any incorrect artifact or claim is delivered, still record it when it exposes a repeatable process failure; mark it `caught_before_delivery`.

## Recurrence and dedicated skills

- Group only cases with the same underlying failure mode, not merely similar symptoms. Keep the individual cases and increment the recurrence count.
- Default escalation threshold: **3 confirmed occurrences** of the same failure mode in this repository. At the threshold, create a narrowly scoped Skill that states the trigger, the failure pattern, the verified prevention workflow, and how to validate the result. Do not create a Skill for a one-off mistake.
- If a matching dedicated Skill already exists, update it with the new evidence instead of creating a duplicate.
- After creating/updating a Skill, validate it with the skill creator's `quick_validate.py`; check that its description only triggers for the relevant work.
- Record the Skill path and escalation date in the ledger. Continue counting recurrences after escalation to measure whether the Skill prevents the error.

## Keep the ledger useful

- Prefer concrete, falsifiable records over blame or vague lessons.
- The “correct method” must be supported by the project's source, specification, or a successful correction; label unresolved cause as unknown.
- Avoid putting secrets, personal data, or large stack traces in the ledger. Reference a local log or artifact path when needed.
- At the end of a task involving errors, verify that the ledger record, recurrence count, correction, and any triggered Skill agree.
- Do not pause routine logging or Skill escalation for user confirmation. Ask only if the correct method or scope cannot be established from available evidence.

## Automated check

After changing either ledger file, run from the repository root:

```powershell
python .agents/skills/project-error-ledger/scripts/check_ledger.py
```

The checker validates JSONL fields, unique case IDs, Markdown/JSONL case coverage, recurrence sequences, threshold consistency, and the existence of a linked Skill after escalation. It does not determine whether two incidents truly share a root cause; use evidence and judgment for that classification.
