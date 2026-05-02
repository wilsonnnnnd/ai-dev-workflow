Load:
- AGENTS.md
- .aidw/project.md
- .aidw/rules.md
- .aidw/workflow.md
- .aidw/safety.md
- .aidw/system-overview.md
- .aidw/task-entry.md
- .aidw/confirmation-protocol.md
- current task file, when one exists

# Task

My request:
[WRITE YOUR REQUIREMENT HERE]

# Instructions

Use `AGENTS.md` as the source of truth.

- Decide mode:
  - REVIEW: user asks to review or provides an existing prompt/plan/task/implementation.
  - IMPLEMENT: otherwise.
- If vague: ask only implementation-boundary questions, then stop.
- If clear: draft a task (Goal, Background, Scope, Requirements, Acceptance Criteria, Test Command, Definition of Done), request click-to-confirm, then implement and verify.
- Prefer running tests via `repo-context-kit gate run-test <taskId>` when available.
- For REVIEW without Task/AC: draft minimal Task/AC first, then review against it.

# Constraints

- Follow `.aidw/rules.md`, `.aidw/workflow.md`, and `.aidw/safety.md`.
- Reuse first; keep changes minimal; preserve backward compatibility; do not break existing functionality.

# Output Rules

- Do not write code unless the user explicitly requests implementation and confirms the task draft.
- Do not skip clarification for vague requests.
- Output must match the selected behavior (clarify / implement / review).
