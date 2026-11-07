---
name: Refactoring Workflow
description: Safe, incremental refactoring approach that doesn't break things
tags: [refactoring, workflow, architecture]
platforms: [generic]
source: marketplace
source_url: https://marketplace.example.com/refactoring
author: Marketplace Author
created_at: 2026-06-20
updated_at: 2026-07-10
usage_notes: |
  The "test first" rule is the most important one.
  Don't refactor code that doesn't have tests — write tests first.
---

# Refactoring Workflow

Safe refactoring in 6 steps.

## Steps

1. **Ensure tests exist** — If no tests, write them first. You need a safety net.
2. **Run tests, confirm they pass** — Green baseline.
3. **Make a small refactoring** — One change, one concept.
4. **Run tests again** — Should still pass.
5. **Commit** — Small, atomic commit.
6. **Repeat** — Next small refactoring.

## Rules

- Never refactor and add features in the same commit
- If tests fail after a refactoring, revert — don't debug forward
- Rename before you restructure
