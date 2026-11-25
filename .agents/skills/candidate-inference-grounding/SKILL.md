---
name: candidate-inference-grounding
description: Ground motive, intention, willingness, emotion, and social-action labels in literary candidate summaries when the source may show only dialogue, action, silence, or an unresolved response.
metadata:
  short-description: Ground literary motive claims
---

# Candidate Inference Grounding

Use this skill while source-checking literary candidate events whenever a summary assigns a motive, intention, willingness, emotion, or socially meaningful action label such as apology, threat, consent, or forgiveness.

## Workflow

1. Locate the exact sentence or narrated thought that supports the claim. Inspect the surrounding passage, including the character's reply and the next transition.
2. Separate three evidence types: explicit narration of a character's inner state; a character's own spoken or reported belief; and an analyst's interpretation from behavior. A character's belief about another person is not proof that the belief is correct.
3. Do not turn silence, delay, a missing reply, an action, or another character's advice into a settled motive. Preserve unresolved states as unknown, for example: “the source has not yet shown whether he agrees.”
4. Ground action labels in what the character says and does. Concern or checking an injury is not automatically an apology; a playful reply is not automatically consent; a warning is not automatically a threat. If the label adds a social act beyond the narrated behavior, mark it as interpretation or use a narrower description.
5. If an interpretation is useful, label it as an inference and state the observed facts separately. Do not upgrade an inference to fact merely because it fits a familiar relationship pattern.
6. Check headings, observations, emotional/need assumptions, and trajectory summaries for stronger wording than the cited passage supports. Keep batch, progress, and unified-index fields consistent.
7. When correcting an actual artifact error, record it in both project error-ledger files, use the confirmed recurrence count, and run the ledger checker.

## Validation

For each motive or willingness claim, a reviewer should be able to point to explicit source wording or see that the claim is marked as an inference/unknown. Verify the correction against the rendered source page and check the following passage for a later answer that changes the state.
