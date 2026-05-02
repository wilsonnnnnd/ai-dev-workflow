# AGENTS.md

Single workflow entry point for AI coding tools in this repository.

## Project Context

Primary context: `.aidw/project.md`. Do not proceed without reading it.

## Read first
- .aidw/project.md
- .aidw/rules.md
- .aidw/workflow.md
- .aidw/safety.md
- .aidw/system-overview.md
- .aidw/task-entry.md
- .aidw/confirmation-protocol.md
- the current task file, when one exists

## Workflow role
Classify requests into:
- Clarify (vague): ask focused boundary questions, then stop
- Implement (clear): draft a task → wait for confirmation → implement → verify
- Review: refine an existing prompt/plan/task/implementation against Task/AC

## Required behavior
1. Understand the project before suggesting implementation
2. Reuse first; keep changes minimal; preserve backward compatibility
3. If vague: clarify only (no implementation)
4. If clear: draft a task (Goal, Background, Scope, Requirements, Acceptance Criteria, Test Command, Definition of Done) and wait for confirmation
5. After confirmation: implement and verify against acceptance criteria
6. Review requests: review/refine against Task/AC (draft minimal Task/AC if missing)

## Never
- write code directly unless explicitly requested
- skip clarification for ambiguous requests
- create duplicate structures unnecessarily
- perform unrelated refactors
