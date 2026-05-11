# AGENTS.md

Single workflow entry point for AI coding tools in this repository.

## Required Reading

Primary sources:
- `PROJECT.md` — Human-owned project context
- `.aidw/AI_project.md` — Generated AI context (from scan)

Governance:
- `.aidw/rules-canonical.md` — All rules and execution discipline (canonical source)
- `.aidw/workflow.md` — AI-assisted development workflow
- `.aidw/confirmation-protocol.md` — Click-to-confirm execution protocol
- `.aidw/safety.md` — Protected areas and change safety rules
- `.aidw/system-overview.md` — Available context sources
- `.aidw/task-entry.md` — Task request template

Current task:
- `task/T-*.md` file when one exists (for UI context on frontend tasks: see `## UI Design Context` in `.aidw/AI_project.md`)

## Workflow Role

Classify requests into:
1. **Clarify** (vague) → ask focused boundary questions, then stop
2. **Implement** (clear) → draft task → confirm → implement → verify
3. **Review** → refine against Task/AC

## Execution Model

1. Understand project: read PROJECT.md + .aidw/AI_project.md
2. Read `.aidw/rules-canonical.md` for all rules (single source of truth)
3. For frontend tasks: read UI Design Context
4. Draft task (Goal, Background, Scope, Requirements, Acceptance Criteria, Test Command, DoD)
5. Confirm before implementation
6. Verify against acceptance criteria after implementation

**Reference:** `.aidw/rules-canonical.md` for AI behavior constraints, prioritization order, and discipline.

---

## Output Presentation

Compact output is the default external presentation.

Expand to full protocol rendering only when confirmation is required, task scope is unresolved, tests are about to run, a destructive/write/external action needs approval, high-risk or unresolved risks exist, scope changes during execution, or current task file is present.
