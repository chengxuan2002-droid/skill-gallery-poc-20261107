# Skill File Format

Skills can be stored in two forms:

- **Single-file:** A standalone `.md` file under `skills/`. Good for simple skills.
- **Directory:** A subdirectory under `skills/` containing a `SKILL.md` plus any attached files (scripts, configs, templates, etc.). Good for complex, self-built skills.

## Naming

- Filename (or directory name) = slug (URL-friendly identifier)
- Use lowercase letters, numbers, and hyphens only
- Single-file example: `systematic-debugging.md`
- Directory example: `handoff-codex/SKILL.md`

## Frontmatter Fields

| Field | Required | Type | Description |
|---|---|---|---|
| `name` | ✓ | string | Display name |
| `description` | ✓ | string | One-line summary |
| `tags` | ✓ | array | Category tags |
| `platforms` | ✓ | array | Target platforms: `codex`, `claude-code`, `cursor`, `generic`, etc. |
| `source` | ✓ | string | Source type: `self-built`, `github`, `marketplace`, `platform-native`, `other` |
| `source_url` | ✗ | string | Original URL |
| `author` | ✗ | string | Original author |
| `created_at` | ✓ | date | Date added (YYYY-MM-DD) |
| `updated_at` | ✓ | date | Last updated (YYYY-MM-DD) |
| `usage_notes` | ✗ | string | Personal usage notes (multiline with `\|`) |

## Example

```markdown
---
name: My Skill
description: A brief description of what this skill does
tags: [example, workflow]
platforms: [codex, generic]
source: self-built
author: Your Name
created_at: 2026-08-02
updated_at: 2026-08-02
usage_notes: |
  These are my personal notes
  about using this skill.
---

# My Skill

Full skill content in markdown format...
```

## Directory Skill Example

For skills with attached files, use a directory:

```
skills/
└── my-custom-skill/
    ├── SKILL.md          ← main document (required, same frontmatter format)
    ├── scripts/
    │   └── helper.py     ← attached script
    └── assets/
        └── template.txt  ← attached asset
```

The build script automatically scans all files inside a skill directory and lists them as "Attached Files" on the detail page. `SKILL.md` itself is not included in the file list.
