# AI Development Workflow

**See canonical rules: `.aidw/rules-canonical.md`**

## Standard Flow

1. Read AGENTS.md first
2. Read PROJECT.md + .aidw/AI_project.md
3. Read .aidw/rules-canonical.md (all rules and constraints)
4. For frontend tasks: Read `## UI Design Context` in .aidw/AI_project.md
5. Read current task file (when one exists)
6. Identify affected files
7. **Implement in order: Logic → Data/State → UI** (where applicable)
8. Make smallest safe change
9. Run task test command (prefer `repo-context-kit gate run-test` when available)
10. Report: changed files, tests, remaining risks

## Context Budget Policy

- **Default**: Digest + compact output
- **Upgrade only when**: High risk, test failure, stale scan, auth/payment/security touched, repeated failure
- **All upgrades**: Explainable, deterministic, bounded
- **Forbidden**: Full context dump unless explicitly requested

## Key Rules

See `.aidw/rules-canonical.md` for:
- Reuse first discipline
- Implementation order
- Scope control
- UI discipline
- Safety constraints
- AI behavior constraints

