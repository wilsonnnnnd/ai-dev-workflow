# AI 自动化执行确认协议（v1）

本文件定义一个可移植的“点选确认”状态机协议，用于在 Trae 对话流程、VSCode Copilot Chat、Codex 等宿主中统一驱动：

用户给需求 → 自动产 Task → 点选确认 → 自动实现 → 自动跑测试 → 自动按 AC 输出验收报告

目标：

- 把“是否允许继续下一步”的控制点标准化（确认门禁）。
- 把每个阶段的输出格式标准化（可直接照抄、可被工具解析）。
- 在不支持按钮的宿主中，提供等价的“选项确认”降级方式。

非目标：

- 不定义具体实现细节（由项目与任务决定）。
- 不替代项目自身的安全规则与编辑边界。

---

## 术语

- Task：实现任务说明，使用仓库任务模板段落：Goal / Background / Scope / Requirements / Acceptance Criteria / Test Command / Definition of Done。
- AC：Acceptance Criteria（验收标准）。
- 点选确认：宿主提供按钮/选项选择；若不支持按钮，则用“选项编号/固定短语”确认。
- 状态机：从“收到需求”到“完成验收”之间的阶段与跳转规则。

---

## 总体约束（门禁规则）

1. 在 `TASK_CONFIRM` 之前：
   - 不允许修改任何代码文件。
   - 不允许运行任何命令（包括测试）。
2. 在 `TESTS_CONFIRM` 之前：
   - 不允许运行任何命令（包括测试命令）。
3. 评审请求（Review）：
   - 以 Task/AC 为基准评审；若缺 Task/AC，先生成最小 Task/AC，再评审。
4. 任何阶段发现信息不足：
   - 跳转到 `CLARIFY`，仅提出实现边界问题；确认后回到 `TASK_DRAFT`。

---

## 状态机节点

### 状态枚举

- `INTAKE`：接收需求
- `CLASSIFY`：判定评审 vs 实现
- `CLARIFY`：澄清（仅提问，不实现）
- `TASK_DRAFT`：生成 Task 草案
- `TASK_CONFIRM`：点选确认 Task
- `IMPLEMENT`：实现（按 Scope/Requirements）
- `TESTS_CONFIRM`：点选确认测试执行
- `RUN_TESTS`：运行测试命令
- `AC_REPORT`：按 AC 输出验收报告
- `DONE`：结束

### 跳转图（高层）

- `INTAKE` → `CLASSIFY`
- `CLASSIFY`：
  - 评审：`TASK_DRAFT`（若无 Task/AC）→ `TASK_CONFIRM` → `AC_REPORT`
  - 实现：`CLARIFY`（若不清晰）或 `TASK_DRAFT`
- `TASK_DRAFT` → `TASK_CONFIRM`
- `TASK_CONFIRM`：
  - 通过：`IMPLEMENT`
  - 调整：`CLARIFY` 或 `TASK_DRAFT`
- `IMPLEMENT` → `TESTS_CONFIRM`
- `TESTS_CONFIRM`：
  - 运行：`RUN_TESTS` → `AC_REPORT`
  - 跳过：`AC_REPORT`（必须标注“未运行测试”的原因类型）
- `AC_REPORT` → `DONE`

---

## 统一输出格式（每个节点都必须遵循）

每次输出必须包含以下 3 段，且标题固定：

1) `## State`：机器可读状态
2) `## Output`：面向用户的内容（Task 草案、问题列表、验收报告等）
3) `## Confirm`：需要用户点选/选择时，给出选项；不需要确认时写 `- None`

### State 段格式（固定字段）

使用如下格式（字段顺序固定）：

```md
## State
- protocol: confirmation-protocol/v1
- state: <STATE>
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: <true|false>
  - allow_commands: <true|false>
- next: <NEXT_STATE>
```

---

## 节点规范（逐节点）

### 1) INTAKE

进入条件：收到用户自然语言需求。

输出要求：

- 复述需求要点（不扩写方案）。
- 进入 `CLASSIFY`。

固定输出模板：

```md
## State
- protocol: confirmation-protocol/v1
- state: INTAKE
- mode: IMPLEMENT
- gating:
  - allow_file_edits: false
  - allow_commands: false
- next: CLASSIFY

## Output
- Request summary: <一句话复述用户需求>

## Confirm
- None
```

### 2) CLASSIFY

判定规则（满足任一则视为 REVIEW）：

- 用户明确要求“review/评审/检查/改进/优化 prompt/plan/实现”等
- 用户提供现成材料（prompt/plan/代码片段/diff/PR）并请求评价

输出要求：

- 给出 `mode` 选择结果与理由（1 句话）。
- 若 REVIEW 且无 Task/AC：进入 `TASK_DRAFT` 先补 Task。
- 若 IMPLEMENT 且信息不足：进入 `CLARIFY`。

固定输出模板：

```md
## State
- protocol: confirmation-protocol/v1
- state: CLASSIFY
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: false
  - allow_commands: false
- next: <CLARIFY | TASK_DRAFT>

## Output
- Classification: <IMPLEMENT|REVIEW> (reason: <一句话原因>)

## Confirm
- None
```

### 3) CLARIFY

目标：补齐实现边界与验收信息，使得可生成 Task。

输出要求：

- 仅提出问题，不提供实现方案。
- 优先提供“可点选”的选项；每个问题最多 2–4 个选项。
- 若宿主不支持按钮：允许用户用 `A/B/C/D` 或 `1/2/3/4` 作答。

固定输出模板：

```md
## State
- protocol: confirmation-protocol/v1
- state: CLARIFY
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: false
  - allow_commands: false
- next: TASK_DRAFT

## Output
- Questions:
  - Q1: <问题>
  - Q2: <问题>
  - Q3: <问题>

## Confirm
- Options:
  - 1) <选项>
  - 2) <选项>
  - 3) <选项>
  - 4) <选项>
```

### 4) TASK_DRAFT

目标：把需求固化成可实现、可验收的 Task 草案。

输出要求：

- 严格按 Task 段落顺序输出：
  - Goal
  - Background
  - Scope（Allowed to change / Do not change）
  - Requirements
  - Acceptance Criteria
  - Test Command
  - Definition of Done

固定输出模板：

```md
## State
- protocol: confirmation-protocol/v1
- state: TASK_DRAFT
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: false
  - allow_commands: false
- next: TASK_CONFIRM

## Output
### Task Draft
#### Goal
<...>

#### Background
<...>

#### Scope
Allowed to change:
- <...>

Do not change:
- <...>

#### Requirements
- <...>

#### Acceptance Criteria
- <...>

#### Test Command
```bash
<...>
```

#### Definition of Done
- Code implemented.
- Tests added or updated.
- Test command passes.
- Summary includes changed files and verification.

## Confirm
- Choose one:
  - Confirm task (proceed)
  - Adjust task (go to clarify)
  - Switch to review mode
  - Cancel
```

### 5) TASK_CONFIRM

目标：获得用户对 Task 草案的明确授权。

输出要求：

- 不允许要求用户输入长文本；仅允许点选确认或选择“调整/取消”。
- 用户选择 “Confirm task” 后，进入 `IMPLEMENT` 并解除文件编辑门禁。

固定输出模板：

```md
## State
- protocol: confirmation-protocol/v1
- state: TASK_CONFIRM
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: false
  - allow_commands: false
- next: <IMPLEMENT | CLARIFY | AC_REPORT | DONE>

## Output
- Awaiting confirmation for the task draft.

## Confirm
- Choose one:
  - Confirm task (proceed)
  - Adjust task (go to clarify)
  - Switch to review mode
  - Cancel
```

### 6) IMPLEMENT

目标：按 Scope/Requirements 实现变更。

输出要求：

- 产出一个“执行摘要”，列出：
  - Files to change（实际变更文件清单）
  - Key decisions（关键决策与取舍）
  - Anything not implemented（未实现项）
- 不在此阶段输出完整验收报告（留到 `AC_REPORT`）。

固定输出模板：

```md
## State
- protocol: confirmation-protocol/v1
- state: IMPLEMENT
- mode: IMPLEMENT
- gating:
  - allow_file_edits: true
  - allow_commands: false
- next: TESTS_CONFIRM

## Output
- Implementation summary:
  - Files changed:
    - <path>
  - Key decisions:
    - <...>
  - Anything not implemented:
    - <None|...>

## Confirm
- Choose one:
  - Confirm tests (run test command)
  - Skip tests (report without running)
  - Adjust task (back to clarify)
```

### 7) TESTS_CONFIRM

目标：获得执行测试命令的授权。

输出要求：

- 点选确认运行 `Test Command`；或点选跳过（必须选择跳过原因类型）。
- 若提供 `repo-context-kit gate run-test <taskId>`，优先通过 gate 执行测试命令以强制门禁。

固定输出模板：

```md
## State
- protocol: confirmation-protocol/v1
- state: TESTS_CONFIRM
- mode: IMPLEMENT
- gating:
  - allow_file_edits: true
  - allow_commands: false
- next: <RUN_TESTS | AC_REPORT | CLARIFY>

## Output
- Proposed test command:
  - <command>

## Confirm
- Choose one:
  - Run tests
  - Skip tests (reason: no_tests_available)
  - Skip tests (reason: too_expensive_now)
  - Adjust task (back to clarify)
```

### 8) RUN_TESTS

目标：运行测试命令并记录结果。

输出要求：

- 输出测试结果摘要（通过/失败）。
- 失败时：进入 `AC_REPORT`，并在报告中标注受影响的 AC 与失败证据。

固定输出模板：

```md
## State
- protocol: confirmation-protocol/v1
- state: RUN_TESTS
- mode: IMPLEMENT
- gating:
  - allow_file_edits: true
  - allow_commands: true
- next: AC_REPORT

## Output
- Test result:
  - command: <...>
  - exit_code: <...>
  - summary: <pass|fail>

## Confirm
- None
```

### 9) AC_REPORT

目标：按 AC 输出验收报告（最终交付物）。

输出要求：

- 必须逐条列出 AC，并给出状态：`PASS` / `FAIL` / `N/A`。
- 每条 AC 必须附证据字段（最少 1 项）：
  - tests: 命令与结果摘要
  - manual: 手动验证步骤与观察
  - notes: 约束/风险说明
- 必须包含 “Files changed / Tests run / Remaining risks”。

固定输出模板：

```md
## State
- protocol: confirmation-protocol/v1
- state: AC_REPORT
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: <true|false>
  - allow_commands: <true|false>
- next: DONE

## Output
### Acceptance Report

#### Acceptance Criteria
- AC1: <text>
  - status: <PASS|FAIL|N/A>
  - evidence:
    - <tests|manual|notes>: <...>

- AC2: <text>
  - status: <PASS|FAIL|N/A>
  - evidence:
    - <...>

#### Files Changed
- <path>

#### Tests Run
- <command or "skipped">

#### Remaining Risks
- <...>

## Confirm
- None
```

### 10) DONE

目标：结束本次流程。

固定输出模板：

```md
## State
- protocol: confirmation-protocol/v1
- state: DONE
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: false
  - allow_commands: false
- next: NONE

## Output
- Done.

## Confirm
- None
```

---

## 宿主兼容性建议（Trae / Copilot / Codex）

- Trae：把 `## Confirm` 的选项渲染为点选按钮；将“执行命令/写文件”作为受控动作，仅在相应确认后触发。
- Copilot Chat：若无按钮，使用 `1/2/3/4` 选择确认；确保在用户确认之前不输出代码改动指令。
- Codex：同样使用编号确认；若支持“执行工具/命令”能力，必须遵守门禁字段（`allow_commands`）为 true 才可执行。
