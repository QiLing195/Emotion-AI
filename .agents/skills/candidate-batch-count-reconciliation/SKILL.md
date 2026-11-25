---
name: candidate-batch-count-reconciliation
description: Reconcile declared totals and unique candidate IDs in literary event batches, progress files and indexes during source audits.
---

# Candidate Batch Count Reconciliation

Use this when creating, reviewing, correcting, or advancing a chapter batch of candidate events.

1. Count the unique event IDs actually present in the batch, using its heading IDs rather than its introductory total.
2. Check for duplicate, skipped, malformed, or out-of-order IDs and compare the batch’s first and last IDs with the unified index and progress file.
3. Reconcile the declared count and the progress/index records to the batch. Do not infer missing candidate records or alter the corpus total to make counts match.
4. If a mismatch exists, correct the source artifact and record an actual discovered error in both project ledger files. Escalate repeated failure modes at the project ledger threshold.

Completion criterion: the unique heading count equals the declared batch count, every ID occurs once, and the corresponding progress/index span is consistent.
