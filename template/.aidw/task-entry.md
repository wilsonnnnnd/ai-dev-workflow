Load:
- AGENTS.md
- .aidw/project.md
- .aidw/rules.md
- .aidw/workflow.md
- .aidw/safety.md
- .aidw/system-overview.md
- .aidw/task-entry.md
- current task file, when one exists

# Task

My request:
[WRITE YOUR REQUIREMENT HERE]

# Instructions

Use `AGENTS.md` as the source of truth to decide the correct path.

The clarification policy in `AGENTS.md` is the source of truth.
If clarification is required, only ask implementation-boundary questions.

- First decide whether this is a review request:
  - If the user asks to review or provides an existing prompt/plan/task/implementation, treat it as review.
  - Otherwise, treat it as an implementation request.

- If the request is vague or high-level:
  - identify relevant areas
  - ask focused clarification questions
  - stop after clarification

- If the request is clear and implementation-ready:
  - generate a task draft using the repo task template sections:
    - Goal, Background, Scope, Requirements, Acceptance Criteria, Test Command, Definition of Done
  - ask the user to confirm the task draft before implementation (prefer click-to-confirm / multiple choice when supported)
  - after confirmation, implement and verify against the task acceptance criteria and test command

- If a prompt/plan/task/implementation already exists:
  - review and refine it against the task acceptance criteria
  - if no task/acceptance criteria exist yet, draft the minimal task/AC first, then review against it

# Constraints

- Follow .aidw/rules.md strictly
- Follow .aidw/workflow.md and .aidw/safety.md
- Reuse existing components, hooks, utilities, and services
- Keep changes minimal and localized
- Do not break existing functionality
- Protect shared modules and keep them backward compatible

# Output Rules

- Do not write code unless the user explicitly requests implementation and confirms the task draft
- Do not skip clarification for vague requests
- Output must match the selected behavior
