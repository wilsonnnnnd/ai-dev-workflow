# Engineering Rules

**See canonical source: `.aidw/rules-canonical.md`**

This document provides a brief reference. All rules, constraints, and execution discipline are defined in `.aidw/rules-canonical.md`.

## Quick Reference

- **Reuse First**: Extend existing before creating new; preserve backward compatibility
- **Logic First**: Implement business logic → data/state → UI (in that order)
- **Scope Control**: Change only related files; avoid unrelated refactors
- **UI Discipline**: Inspect and reuse existing design system before new UI code
- **Safety**: Do not break existing functionality; preserve all safety gates and protocols
- **Priority**: Reuse > New, Consistency > Cleverness, Safety > Speed

## Detailed Rules

**See: `.aidw/rules-canonical.md`** for:
- Complete rule groups
- AI behavior constraints
- Protected areas
- Context discipline
- Prioritization order

## For Implementation

1. Read `.aidw/rules-canonical.md` for all rules and constraints
2. Reference by name (e.g., "per Logic First rule in rules-canonical.md")
3. Never duplicate rules across files; always reference canonical source

