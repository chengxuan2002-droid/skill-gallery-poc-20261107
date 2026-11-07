---
name: Code Review Assistant
description: Structured code review checklist and feedback format
tags: [code-review, quality, best-practices]
platforms: [codex, claude-code]
source: github
source_url: https://github.com/example/code-review-skill
author: Example Author
created_at: 2026-07-15
updated_at: 2026-08-01
usage_notes: |
  Good for PR reviews. Customize the severity rubric to match your team's standards.
---

# Code Review Assistant

Helps conduct thorough, consistent code reviews.

## Review Dimensions

- **Correctness**: Does the code do what it intends to?
- **Security**: Any vulnerabilities or injection risks?
- **Performance**: Unnecessary work? O(n²) where it should be O(n)?
- **Readability**: Clear naming, consistent style, good comments?
- **Tests**: Are there tests? Do they cover the important cases?

## Feedback Format

Start with severity:
- 🔴 Blocking — must fix before merge
- 🟡 Warning — should fix, discuss if unsure
- 💡 Suggestion — optional improvement
- ❓ Question — need clarification
