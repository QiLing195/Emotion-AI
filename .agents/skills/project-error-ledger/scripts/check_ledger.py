#!/usr/bin/env python3
"""Validate project error ledger IDs, recurrence counters, markdown sync, and escalation."""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path


REQUIRED = {
    "case_id",
    "date",
    "category",
    "failure_mode_key",
    "summary",
    "wrong",
    "cause",
    "correct",
    "detection_and_fix",
    "prevention_check",
    "occurrence",
    "recurrence_threshold",
    "status",
    "dedicated_skill",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--jsonl", type=Path, default=Path("artifacts/project-error-ledger.jsonl"))
    parser.add_argument("--markdown", type=Path, default=Path("artifacts/project-error-ledger.md"))
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    args = parser.parse_args()

    repo = args.repo.resolve()
    ledger = args.jsonl if args.jsonl.is_absolute() else repo / args.jsonl
    markdown = args.markdown if args.markdown.is_absolute() else repo / args.markdown
    errors: list[str] = []
    rows: list[dict] = []
    for line_no, line in enumerate(ledger.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"JSONL line {line_no}: invalid JSON: {exc}")
            continue
        missing = REQUIRED - row.keys()
        if missing:
            errors.append(f"JSONL line {line_no} ({row.get('case_id', '?')}): missing {sorted(missing)}")
        rows.append(row)

    ids = [row.get("case_id") for row in rows]
    if len(ids) != len(set(ids)):
        errors.append("case_id values are not unique")
    md = markdown.read_text(encoding="utf-8-sig")
    for case_id in ids:
        if case_id and case_id not in md:
            errors.append(f"Markdown ledger does not contain {case_id}")

    groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        key = row.get("failure_mode_key")
        if key:
            groups[key].append(row)

    for key, cases in groups.items():
        counts = [case.get("occurrence") for case in cases]
        expected = list(range(1, len(cases) + 1))
        if counts != expected:
            errors.append(f"{key}: occurrence sequence {counts} should be {expected}")
        thresholds = {case.get("recurrence_threshold") for case in cases}
        if len(thresholds) != 1 or not all(isinstance(n, int) and n > 0 for n in thresholds):
            errors.append(f"{key}: inconsistent or invalid recurrence threshold {thresholds}")
            continue
        threshold = next(iter(thresholds))
        latest = cases[-1]
        skill = latest.get("dedicated_skill")
        if len(cases) >= threshold:
            if not skill:
                errors.append(f"{key}: {len(cases)} occurrences reached threshold {threshold}, but latest case has no dedicated_skill")
            else:
                skill_path = (repo / skill).resolve()
                skill_file = skill_path if skill_path.name == "SKILL.md" else skill_path / "SKILL.md"
                if not skill_file.is_relative_to(repo) or not skill_file.is_file():
                    errors.append(f"{key}: dedicated Skill path missing or outside repo: {skill}")
        elif skill:
            skill_path = (repo / skill).resolve()
            skill_file = skill_path if skill_path.name == "SKILL.md" else skill_path / "SKILL.md"
            if not skill_file.is_relative_to(repo) or not skill_file.is_file():
                errors.append(f"{key}: referenced Skill path missing or outside repo: {skill}")

    if errors:
        print("ERROR LEDGER CHECK FAILED")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"ERROR LEDGER CHECK PASSED: {len(rows)} cases, {len(groups)} failure modes")
    for key, cases in groups.items():
        latest = cases[-1]
        threshold = latest["recurrence_threshold"]
        state = "Skill linked" if latest.get("dedicated_skill") else f"{len(cases)}/{threshold} before escalation"
        print(f"- {key}: {len(cases)} occurrence(s), {state}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
