---
name: virtual-activity-grounding
description: Prevent unsupported first-person activity claims when working on this project's virtual town, memory retrieval, or emotional expression. Use for changes or reviews involving virtual event records, real-world activity questions, self-claim grounding, or mood-cause attribution.
metadata:
  short-description: Ground virtual activities in event records
---

# Virtual activity grounding

Use this Skill when changing or reviewing virtual-town activity retrieval, event-grounded self claims, or emotional responses that attribute a mood to an activity.

## Required distinctions

- A virtual-town event is fictional character-world history. It is not the user's real-world activity and not a physical action the assistant performed.
- A first-person claim about an activity is allowed only when the relevant event record supports that exact activity, time, and actor. Do not invent adjacent details such as owning ingredients, making coffee, drinking it, or doing something habitually.
- An event record establishes that an activity occurred; it does not establish that the activity caused an emotion. Mood causality requires a separate explicit observation or user/character expression.
- Missing evidence means “unknown/not recorded,” not evidence that the event did not happen. State the relevant limitation without adding a plausible substitute scene.

## Change and review procedure

1. Trace the evidence path from virtual event storage through retrieval and prompt/context assembly to the final response guard. Keep real-world activity facts and virtual event facts distinguishable at each boundary.
2. Review both generated draft and final guarded answer. A guard that removes hallucinations from the final answer does not prove the model draft is grounded or natural.
3. Cover positive and negative examples: exact event recall; unrecorded café/coffee-making claim; habit claim; omitted subject; event mixed with invented detail; explicit denial; quoted speech; sarcasm; real activity versus virtual activity; activity present but mood cause missing.
4. Preserve a valid recorded event when filtering adjacent unsupported detail. Do not replace an accurate answer wholesale with a contradictory “no record” fallback.
5. Validate with targeted tests and a fixed replay. Report separately: draft violations, guard rewrites, final-answer failures, and response relevance/naturalness. A small deterministic pass does not establish general reliability.
6. When a repeat failure is fixed, add or update its project error-ledger entry and regression case. Do not mark it resolved solely because the final guard hid it.

## Project references

- Error history: `artifacts/project-error-ledger.md` (`virtual-activity-self-claim-ungrounded`).
- Prior failure analysis and replay evidence: `artifacts/v2.31/replay-review.md`, `artifacts/v2.31/replay/guard-rewrite-diagnosis-r4-r6.md`.
- Inspect current source and tests before editing; file paths in older reports may have changed.
