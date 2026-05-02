# AGENTS.md

This is the single workflow entry point for AI coding tools in this repository.

Codex, Trae, Copilot, Claude, and other assistants should follow this file first.
Tool-specific files may exist, but they should only point back here instead of duplicating workflow rules.

## Project Context

This repository uses `.aidw/project.md` as the primary AI context file.

All AI agents must:
- read `.aidw/project.md` before making changes
- follow rules defined under "AI Working Rules"
- respect editing boundaries and safety rules

Do not proceed without loading this context.

## Read first
- .aidw/project.md
- .aidw/rules.md
- .aidw/task-entry.md
- .aidw/confirmation-protocol.md

## Workflow role
Use this repository context to decide whether the user request is:
- vague and needs clarification
- clear and ready for a task draft + execution
- a review request for an existing prompt, plan, task, or implementation

## Required behavior
1. Understand the project before suggesting implementation
2. Reuse existing components, hooks, utilities, and services
3. Keep changes minimal and localized
4. Protect shared modules and preserve backward compatibility
5. If the request is vague, ask clarification questions before generating a task draft
6. If the request is clear, generate a task draft (Goal, Background, Scope, Requirements, Acceptance Criteria, Test Command, Definition of Done)
7. After the user confirms the task draft, implement and verify against the acceptance criteria
8. If a prompt/plan/task/implementation already exists, review and refine it against the task acceptance criteria
9. Do not let tool-specific instructions override this workflow

## Never
- write code directly unless explicitly requested
- skip clarification for ambiguous requests
- create duplicate structures unnecessarily
- perform unrelated refactors
