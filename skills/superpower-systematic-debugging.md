---
name: Systematic Debugging
description: Step-by-step debugging workflow for reproducing and fixing any bug
tags: [debugging, workflow, problem-solving]
platforms: [codex, claude-code, generic]
source: self-built
author: Your Name
created_at: 2026-08-02
updated_at: 2026-08-02
usage_notes: |
  Most useful for bugs that are hard to reproduce.
  Always start with reproduction steps before diving into code.
---

# Systematic Debugging

A rigorous, step-by-step approach to debugging any software issue.

## Steps

1. **Reproduce the bug** — Get a reliable reproduction case. If you can't reproduce it, you can't fix it.
2. **Narrow the scope** — Bisect commits, disable features, find the minimal input that triggers it.
3. **Form a hypothesis** — What could cause this behavior? Write it down.
4. **Test the hypothesis** — Add logging, use a debugger, run experiments.
5. **Implement the fix** — Smallest possible change.
6. **Verify** — Confirm the bug is gone and no regressions were introduced.
7. **Add a test** — Prevent the bug from coming back.

## Common Pitfalls

- Changing multiple things at once
- Assuming the bug is in someone else's code
- Skipping reproduction to "just look at the code"
