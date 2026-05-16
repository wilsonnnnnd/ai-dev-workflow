import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main as runCliMain } from "../bin/cli.js";
import { runInit } from "../bin/init.js";
import { runScan } from "../bin/scan.js";
import * as contextModule from "../bin/context.js";
import * as taskModule from "../bin/task.js";
import { computeContextFreshness } from "../src/scan/index.js";
import { createMcpServer } from "../src/mcp/server.js";
import { MCP_CAPABILITY_TIERS, buildMcpCapabilityPolicy } from "../src/mcp/tools.js";
import { appendLoopEvent, listRecentLoopEvents } from "../src/loop/store.js";
import { validateRuntimeContract } from "../src/runtime/runtime-schema.js";
import { CONTEXT_BUDGET, budgetJsonPayload, estimateTokenUnits } from "../src/runtime/context-budget.js";
import { serializeCompactJson } from "../src/runtime/serialize.js";
import * as compressionModule from "../src/runtime/context-compression.js";
import { computeRelevanceScore, rankFilesForContext } from "../src/runtime/context-relevance.js";

const originalCwd = process.cwd();

function rmTempDirTolerant(tempDir) {
    try {
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
    } catch (error) {
        if (process.platform !== "win32" || !["ENOENT", "EPERM", "EBUSY", "ENOTEMPTY"].includes(error?.code)) {
            throw error;
        }
    }
}

async function withTempProject(callback) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-context-kit-"));
    try {
        process.chdir(tempDir);
        return await callback(tempDir);
    } finally {
        process.chdir(originalCwd);
        rmTempDirTolerant(tempDir);
    }
}

function writeFile(relativePath, content = "") {
    const fullPath = path.resolve(process.cwd(), relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
}

async function withCapturedConsole(callback) {
    const log = console.log;
    const error = console.error;
    const output = [];
    try {
        console.log = (...args) => output.push(args.join(" "));
        console.error = (...args) => output.push(args.join(" "));
        const result = await callback();
        return { output, result };
    } finally {
        console.log = log;
        console.error = error;
    }
}

async function withMutedConsole(callback) {
    const { result } = await withCapturedConsole(callback);
    return result;
}

function minimalRegistry() {
    return `# Task Registry

## Tasks

| ID | Title | Status | Priority | Owner | Dependencies | File |
|----|------|--------|----------|-------|--------------|------|
| T-001 | Core Runtime | todo | high | ai | - | [T-001](./T-001-core-runtime.md) |
`;
}

function minimalTask() {
    return `# T-001 Core Runtime

## Goal

Keep the runtime surface compact.

## Scope

- bin/cli.js
- src/mcp/tools.js

## Acceptance Criteria

- Removed commands fail as unknown.
- Runtime JSON remains available.

## Test Command

\`\`\`bash
npm test
\`\`\`
`;
}

function assertCompactJsonText(text, message) {
    const trimmed = String(text ?? "").trim();
    const parsed = JSON.parse(trimmed);
    assert.equal(trimmed, JSON.stringify(parsed), message);
    assert.ok(Buffer.byteLength(trimmed, "utf8") <= CONTEXT_BUDGET.maxPayloadBytes, message);
    assert.ok(estimateTokenUnits(trimmed) <= CONTEXT_BUDGET.maxApproxTokenUnits, message);
}

async function withMcpServer(options, callback) {
    const args = options.args || [];
    const getFlag = (name) => args.includes(name);
    const getArgValue = (name) => {
        const index = args.indexOf(name);
        const value = index >= 0 ? args[index + 1] : null;
        return value && !value.startsWith("--") ? value : null;
    };
    const server = createMcpServer({
        rootDir: getArgValue("--root") || process.cwd(),
        enableWrite: getFlag("--enable-write"),
        enableTests: getFlag("--enable-tests"),
        enableExternalSideEffects: getFlag("--enable-external-side-effects"),
        runCli:
            options.runCli ||
            (async ({ rootDir, args: cliArgs }) => {
                const previousCwd = process.cwd();
                const previousExitCode = process.exitCode;
                try {
                    process.chdir(rootDir);
                    process.exitCode = 0;
                    const { output } = await withCapturedConsole(() => runCliMain(cliArgs));
                    return {
                        code: process.exitCode || 0,
                        stdout: output.length ? `${output.join("\n")}\n` : "",
                        stderr: "",
                    };
                } finally {
                    process.chdir(previousCwd);
                    process.exitCode = previousExitCode;
                }
            }),
        version: JSON.parse(fs.readFileSync(path.resolve(originalCwd, "package.json"), "utf-8")).version,
    });
    let nextId = 1;

    async function request(method, params) {
        return await server.handle({ jsonrpc: "2.0", id: nextId++, method, params });
    }

    return await callback({ request });
}

async function callMcpTool(request, name, args = {}) {
    const response = await request("tools/call", { name, arguments: args });
    assert.equal(Boolean(response.error), false, `tool call failed: ${name}`);
    const text = response?.result?.content?.[0]?.text;
    assert.equal(typeof text, "string", `missing text payload: ${name}`);
    const trimmed = text.trimStart();
    assert.ok(trimmed.startsWith("{"), `tool output must be JSON object text: ${name}`);
    assert.ok(!trimmed.startsWith("#"), `tool output must not be markdown document text: ${name}`);
    assert.ok(Buffer.byteLength(text, "utf8") <= CONTEXT_BUDGET.maxPayloadBytes, `tool output exceeds byte budget: ${name}`);
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        assert.fail(`tool output is not JSON: ${name}`);
    }
    assertCompactJsonText(text, name);
    assert.equal(typeof parsed, "object", `parsed payload must be object: ${name}`);
    assert.notEqual(parsed, null, `parsed payload must not be null: ${name}`);
    return { parsed, text };
}

test("default help exposes only the slim agent runtime surface", async () => {
    const { output } = await withCapturedConsole(() => runCliMain(["--help"]));
    const text = output.join("\n");

    assert.match(text, /\binit\b/);
    assert.match(text, /scan \[--check\]/);
    assert.match(text, /context next-task/);
    assert.match(text, /task prompt <taskId>/);
    assert.match(text, /gate status\|confirm\|run-test/);
    assert.match(text, /repo-context-kit-mcp/);
    assert.doesNotMatch(text, /\b(auto|bootstrap|hygiene|ui)\b|github auth|runtime snapshot|task new|context for\b|context next\b(?!-task)/);
});

test("removed public commands fail clearly as unknown", async () => {
    for (const args of [
        ["auto"],
        ["ui"],
        ["status"],
        ["bootstrap", "doctor"],
        ["hygiene", "scan"],
        ["github", "auth", "status"],
        ["runtime", "snapshot", "list"],
        ["execute", "status"],
        ["loop", "report"],
        ["learn", "ingest"],
        ["budget", "show"],
        ["decision", "explain"],
    ]) {
        process.exitCode = 0;
        const { output } = await withCapturedConsole(() => runCliMain(args));
        assert.equal(process.exitCode, 1, args.join(" "));
        assert.match(output.join("\n"), /Unknown command:/);
    }
    process.exitCode = 0;
});

test("removed aliases and task helpers fail as unknown", async () => {
    await withTempProject(async () => {
        await withMutedConsole(() => runInit());

        for (const args of [
            ["context", "next"],
            ["context", "for", "T-001"],
            ["context", "doctor"],
            ["context", "trace", "T-001"],
            ["context", "budget"],
            ["task", "new", "Example"],
            ["task", "from-doc", "docs/spec.md"],
            ["task", "generate"],
            ["task", "cleanup", "T-001"],
            ["task", "run"],
        ]) {
            process.exitCode = 0;
            const { output } = await withCapturedConsole(() => runCliMain(args));
            assert.equal(process.exitCode, 1, args.join(" "));
            assert.match(output.join("\n"), /Unknown/);
        }
        process.exitCode = 0;
    });
});

test("scan writes runtime/v1 JSON and core context/task commands remain usable", async () => {
    await withTempProject(async () => {
        await withMutedConsole(() => runInit());
        writeFile("package.json", JSON.stringify({ name: "slim-core", version: "0.0.0", type: "module" }, null, 4) + "\n");
        writeFile("src/index.js", "export const answer = 42;\n");
        writeFile("task/task.md", minimalRegistry());
        writeFile("task/T-001-core-runtime.md", minimalTask());

        await withMutedConsole(() => runScan());

        for (const runtimeFile of ["task.json", "context.json", "execution.json", "verification.json"]) {
            const payload = JSON.parse(fs.readFileSync(path.resolve(".aidw/runtime", runtimeFile), "utf-8"));
            assert.equal(payload.schemaVersion, "runtime/v1");
            assert.equal(typeof payload.generatedAt, "string");
            assert.ok(typeof payload.source === "string" || (payload.source && typeof payload.source === "object"));
        }

        for (const args of [
            ["context", "brief"],
            ["context", "next-task"],
            ["context", "workset", "T-001"],
            ["task", "prompt", "T-001"],
            ["task", "checklist", "T-001"],
            ["task", "pr", "T-001"],
            ["metrics"],
        ]) {
            process.exitCode = 0;
            const { output } = await withCapturedConsole(() => runCliMain(args));
            assert.equal(process.exitCode, 0, args.join(" "));
            const text = output.join("\n").trim();
            assert.ok(text.length > 0, args.join(" "));
            assertCompactJsonText(`${text}\n`, args.join(" "));
        }
    });
});

test("scan --plan is no longer a public CLI mode", async () => {
    await withTempProject(async () => {
        await withMutedConsole(() => runInit());
        process.exitCode = 0;
        const { output } = await withCapturedConsole(() => runCliMain(["scan", "--plan"]));
        assert.equal(process.exitCode, 1);
        assert.match(output.join("\n"), /Unknown scan option: --plan/);
        process.exitCode = 0;
    });
});

test("MCP exposes only core runtime/index/context/task/gate tools", async () => {
    await withTempProject(async (tempDir) => {
        await withMutedConsole(() => runInit());
        writeFile("package.json", JSON.stringify({ name: "mcp-slim", version: "0.0.0", type: "module" }, null, 4) + "\n");
        writeFile("src/widget.js", "export function widget() { return true; }\n");
        writeFile("task/task.md", minimalRegistry());
        writeFile("task/T-001-core-runtime.md", minimalTask());
        await withMutedConsole(() => runScan());

        await withMcpServer({ args: ["--root", tempDir] }, async ({ request }) => {
            await request("initialize", {});
            const list = await request("tools/list", {});
            const names = list.result.tools.map((item) => item.name).sort();

            assert.deepEqual(
                names,
                [
                    "rck.repo.summary",
                    "rck.context.brief",
                    "rck.context.nextTask",
                    "rck.context.workset",
                    "rck.file.search",
                    "rck.file.summary",
                    "rck.gate.status",
                    "rck.metrics",
                    "rck.runtime.validate",
                    "rck.scan.check",
                    "rck.symbol.lookup",
                    "rck.task.checklist",
                    "rck.task.pr",
                    "rck.task.prompt",
                ].sort(),
            );
            assert.equal(list.result.tools.every((item) => item.capabilityTier === "read-only"), true);

            const brief = await request("tools/call", { name: "rck.context.brief", arguments: {} });
            assert.equal(Boolean(brief.error), false);
            assert.doesNotMatch(brief.result.content[0].text, /mcp-slim/);
            assert.match(brief.result.content[0].text, /"schemaVersion":"runtime\/v1"/);

            const search = await request("tools/call", { name: "rck.file.search", arguments: { query: "widget" } });
            assert.match(search.result.content[0].text, /src\/widget\.js/);

            const removed = await request("tools/call", { name: "rck.auto.start", arguments: {} });
            assert.equal(removed.error.code, -32603);
            assert.match(removed.error.message, /Unknown tool: rck\.auto\.start/);
        });
    });
});

test("MCP write/test tiers keep the confirmation-gated core only", async () => {
    await withTempProject(async (tempDir) => {
        await withMutedConsole(() => runInit());
        writeFile("package.json", JSON.stringify({ name: "mcp-gates", version: "0.0.0", type: "module" }, null, 4) + "\n");
        writeFile("task/task.md", minimalRegistry());
        writeFile("task/T-001-core-runtime.md", minimalTask());
        await withMutedConsole(() => runScan());

        await withMcpServer({ args: ["--root", tempDir, "--enable-write", "--enable-tests"] }, async ({ request }) => {
            await request("initialize", {});
            const list = await request("tools/list", {});
            const names = list.result.tools.map((item) => item.name);
            const tiers = new Map(list.result.tools.map((item) => [item.name, item.capabilityTier]));

            assert.ok(names.includes("rck.init"));
            assert.ok(names.includes("rck.scan"));
            assert.ok(names.includes("rck.gate.confirmTask"));
            assert.ok(names.includes("rck.gate.confirmTests"));
            assert.ok(names.includes("rck.gate.runTest"));
            assert.ok(!names.includes("rck.task.new"));
            assert.ok(!names.includes("rck.hygiene.apply"));
            assert.equal(tiers.get("rck.scan"), MCP_CAPABILITY_TIERS.WORKFLOW_WRITE);
            assert.equal(tiers.get("rck.gate.runTest"), MCP_CAPABILITY_TIERS.TEST_EXEC);
        });
    });
});

test("MCP read tools return bounded runtime/v1 JSON without CLI shell transport", async () => {
    await withTempProject(async (tempDir) => {
        await withMutedConsole(() => runInit());
        writeFile("package.json", JSON.stringify({ name: "mcp-json-contract", version: "0.0.0", type: "module" }, null, 4) + "\n");
        writeFile("src/index.js", "export const x = 1;\n");
        writeFile("task/task.md", minimalRegistry());
        writeFile("task/T-001-core-runtime.md", minimalTask());
        await withMutedConsole(() => runScan());

        let runCliCallCount = 0;
        await withMcpServer(
            {
                args: ["--root", tempDir],
                runCli: async () => {
                    runCliCallCount += 1;
                    return { code: 0, stdout: "", stderr: "" };
                },
            },
            async ({ request }) => {
                await request("initialize", {});

                const repoSummary = await callMcpTool(request, "rck.repo.summary");
                assert.equal(repoSummary.parsed.schemaVersion, "runtime/v1");
                assert.equal(repoSummary.parsed.interface, "mcp");
                assert.equal(repoSummary.parsed.repository.name, "mcp-json-contract");
                assert.equal(repoSummary.parsed.runtime.taskFile, ".aidw/runtime/task.json");
                const repoSummaryRepeat = await callMcpTool(request, "rck.repo.summary");
                assert.equal(repoSummaryRepeat.text, repoSummary.text);

                const contextBrief = await callMcpTool(request, "rck.context.brief");
                assert.equal(contextBrief.parsed.schemaVersion, "runtime/v1");
                assert.ok(Array.isArray(contextBrief.parsed.context.techStack));
                assert.ok(Array.isArray(contextBrief.parsed.context.riskAreas));
                assert.ok(contextBrief.parsed.context.techStack.length <= 12);
                assert.ok(contextBrief.parsed.context.riskAreas.length <= 12);
                assert.ok(Array.isArray(contextBrief.parsed.verification.requiredChecks));
                assert.ok(contextBrief.parsed.verification.requiredChecks.length <= 8);
                const contextBriefRepeat = await callMcpTool(request, "rck.context.brief");
                assert.equal(contextBriefRepeat.text, contextBrief.text);

                const nextTask = await callMcpTool(request, "rck.context.nextTask");
                assert.equal(nextTask.parsed.schemaVersion, "runtime/v1");
                assert.equal(nextTask.parsed.nextTask.id, "T-001");
                assert.equal(typeof nextTask.parsed.taskCounts.todo, "number");
                assert.equal(typeof nextTask.parsed.taskCounts.in_progress, "number");

                const worksetCompact = await callMcpTool(request, "rck.context.workset", { taskId: "T-001" });
                assert.equal(worksetCompact.parsed.schemaVersion, "runtime/v1");
                assert.equal(worksetCompact.parsed.task.id, "T-001");
                assert.equal(worksetCompact.parsed.workset.detail, "compact");
                assert.equal(worksetCompact.parsed.workset.deep, false);
                assert.ok(Array.isArray(worksetCompact.parsed.workset.files));
                assert.ok(worksetCompact.parsed.workset.files.length <= 10);
                assert.ok(worksetCompact.parsed.workset.entrypoints.length <= 12);
                assert.ok(worksetCompact.parsed.workset.riskAreas.length <= 10);

                const worksetFullDeep = await callMcpTool(request, "rck.context.workset", {
                    taskId: "T-001",
                    detail: "full",
                    deep: true,
                });
                assert.equal(worksetFullDeep.parsed.workset.detail, "full");
                assert.equal(worksetFullDeep.parsed.workset.deep, true);
                assert.ok(worksetFullDeep.parsed.workset.files.length <= 28);
                assert.ok(worksetFullDeep.parsed.workset.entrypoints.length <= 20);
                assert.ok(worksetFullDeep.parsed.workset.riskAreas.length <= 16);

                const taskPrompt = await callMcpTool(request, "rck.task.prompt", { taskId: "T-001" });
                assert.equal(taskPrompt.parsed.schemaVersion, "runtime/v1");
                assert.equal(taskPrompt.parsed.kind, "task-prompt");
                assert.equal(taskPrompt.parsed.task.id, "T-001");
                assert.ok(Array.isArray(taskPrompt.parsed.task.scope));
                assert.ok(taskPrompt.parsed.task.scope.length <= 16);
                assert.ok(Array.isArray(taskPrompt.parsed.task.requirements));
                assert.ok(taskPrompt.parsed.task.requirements.length <= 16);
                assert.ok(Array.isArray(taskPrompt.parsed.task.acceptanceCriteria));
                assert.ok(taskPrompt.parsed.task.acceptanceCriteria.length <= 16);
                assert.ok(Array.isArray(taskPrompt.parsed.context.entrypoints));
                assert.ok(taskPrompt.parsed.context.entrypoints.length <= 12);
                assert.ok(taskPrompt.parsed.context.riskAreas.length <= 10);
                assert.equal(taskPrompt.parsed.task.testCommand?.includes("```"), false);
                assert.equal(JSON.stringify(taskPrompt.parsed).includes("## Goal"), false);
                assert.equal(JSON.stringify(taskPrompt.parsed).includes("## Scope"), false);

                const taskChecklist = await callMcpTool(request, "rck.task.checklist", { taskId: "T-001" });
                assert.equal(taskChecklist.parsed.schemaVersion, "runtime/v1");
                assert.equal(taskChecklist.parsed.kind, "task-checklist");
                assert.equal(taskChecklist.parsed.task.id, "T-001");
                assert.ok(Array.isArray(taskChecklist.parsed.checklist.acceptanceCriteria));
                assert.ok(taskChecklist.parsed.checklist.acceptanceCriteria.length <= 16);
                assert.ok(Array.isArray(taskChecklist.parsed.checklist.definitionOfDone));
                assert.ok(taskChecklist.parsed.checklist.definitionOfDone.length <= 16);
                assert.ok(Array.isArray(taskChecklist.parsed.checklist.requiredChecks));
                assert.ok(taskChecklist.parsed.checklist.requiredChecks.length <= 8);

                const taskPr = await callMcpTool(request, "rck.task.pr", { taskId: "T-001" });
                assert.equal(taskPr.parsed.schemaVersion, "runtime/v1");
                assert.equal(taskPr.parsed.kind, "task-pr-framing");
                assert.match(taskPr.parsed.pr.title, /^T-001\s/);
                assert.ok(Array.isArray(taskPr.parsed.pr.scope));
                assert.ok(taskPr.parsed.pr.scope.length <= 16);
                assert.ok(Array.isArray(taskPr.parsed.pr.verification.requiredChecks));
                assert.ok(taskPr.parsed.pr.verification.requiredChecks.length <= 8);
                assert.ok(Array.isArray(taskPr.parsed.pr.verification.warnings));
                assert.ok(taskPr.parsed.pr.verification.warnings.length <= 8);

                const gateStatus = await callMcpTool(request, "rck.gate.status");
                assert.equal(gateStatus.parsed.schemaVersion, "runtime/v1");
                assert.equal(gateStatus.parsed.interface, "mcp");
                assert.equal(typeof gateStatus.parsed.gate, "object");
                assert.notEqual(gateStatus.parsed.gate, null);

                const scanCheck = await callMcpTool(request, "rck.scan.check");
                assert.equal(scanCheck.parsed.schemaVersion, "runtime/v1");
                assert.equal(scanCheck.parsed.interface, "mcp");
                assert.equal(typeof scanCheck.parsed.scanCheck, "object");
                assert.equal(scanCheck.parsed.scanCheck.changed, false);
                assert.equal(scanCheck.parsed.scanCheck.skipped, false);
            },
        );

        assert.equal(runCliCallCount, 0, "read tools must not shell out to CLI");
    });
});

test("MCP capability policy requires explicit opt-in by tier", () => {
    assert.equal(buildMcpCapabilityPolicy().allows("workflow-write"), false);
    assert.equal(buildMcpCapabilityPolicy({ enableWrite: true }).allows("workflow-write"), true);
    assert.equal(buildMcpCapabilityPolicy({ enableWrite: true }).allows("test-exec"), false);
    assert.equal(buildMcpCapabilityPolicy({ enableWrite: true, enableTests: true }).allows("test-exec"), true);
});

test("runtime/v1 validator accepts active runtime context/task envelopes", async () => {
    await withTempProject(async () => {
        await withMutedConsole(() => runInit());
        writeFile("package.json", JSON.stringify({ name: "runtime-validator-envelope", version: "0.0.0", type: "module" }, null, 4) + "\n");
        writeFile("src/index.js", "export const value = 1;\n");
        writeFile("task/task.md", minimalRegistry());
        writeFile("task/T-001-core-runtime.md", minimalTask());

        await withMutedConsole(() => runScan());

        const runtimeContext = JSON.parse(fs.readFileSync(path.resolve(".aidw/runtime/context.json"), "utf-8"));
        const runtimeTask = JSON.parse(fs.readFileSync(path.resolve(".aidw/runtime/task.json"), "utf-8"));

        const contextValidation = validateRuntimeContract(runtimeContext);
        const taskValidation = validateRuntimeContract(runtimeTask);

        assert.equal(contextValidation.valid, true, contextValidation.errors.join("; "));
        assert.equal(taskValidation.valid, true, taskValidation.errors.join("; "));
    });
});

test("runtime/v1 validator rejects invalid or missing envelope fields", () => {
    const missingEnvelope = {
        schemaVersion: "runtime/v1",
        generatedAt: new Date().toISOString(),
        source: { generatedBy: "test", inputs: [] },
    };

    const badPayloadShape = {
        schemaVersion: "runtime/v1",
        generatedAt: new Date().toISOString(),
        source: { generatedBy: "test", inputs: [] },
        kind: "context",
        payload: [],
    };

    const missingFieldResult = validateRuntimeContract(missingEnvelope);
    const badPayloadResult = validateRuntimeContract(badPayloadShape);

    assert.equal(missingFieldResult.valid, false);
    assert.ok(missingFieldResult.errors.some((item) => item.includes("kind: missing")));
    assert.ok(missingFieldResult.errors.some((item) => item.includes("payload: missing")));

    assert.equal(badPayloadResult.valid, false);
    assert.ok(badPayloadResult.errors.some((item) => item.includes("payload: must be an object")));
});

test("runtime/v1 validator does not accept legacy contract shape", () => {
    const legacyContract = {
        schemaVersion: "runtime/v1",
        runtimeVersion: "1",
        repoRoot: ".",
        workset: { mode: "compact", files: [], summary: "old", text: "old" },
        prompt: "old",
        risks: [],
        nextActions: [],
        executionState: null,
    };

    const result = validateRuntimeContract(legacyContract);

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((item) => item.includes("runtimeVersion: legacy runtime-contract field")));
    assert.ok(result.errors.some((item) => item.includes("repoRoot: legacy runtime-contract field")));
    assert.ok(result.errors.some((item) => item.includes("workset: legacy runtime-contract field")));
    assert.ok(result.errors.some((item) => item.includes("kind: missing")));
    assert.ok(result.errors.some((item) => item.includes("payload: missing")));
});

test("CLI context/task defaults are JSON-first, bounded, and avoid full .aidw markdown injection", async () => {
    await withTempProject(async () => {
        await withMutedConsole(() => runInit());
        writeFile("package.json", JSON.stringify({ name: "context-diet", version: "0.0.0", type: "module" }, null, 4) + "\n");
        writeFile("src/main.js", "export function main() { return 1; }\n");
        writeFile("task/task.md", minimalRegistry());
        writeFile("task/T-001-core-runtime.md", minimalTask());
        await withMutedConsole(() => runScan());

        const commands = [
            ["context", "brief"],
            ["context", "next-task"],
            ["context", "workset", "T-001"],
            ["task", "prompt", "T-001"],
            ["task", "checklist", "T-001"],
            ["task", "pr", "T-001"],
        ];

        for (const args of commands) {
            process.exitCode = 0;
            const { output } = await withCapturedConsole(() => runCliMain(args));
            assert.equal(process.exitCode, 0, args.join(" "));
            const text = output.join("\n").trim();
            assert.ok(text.startsWith("{"), args.join(" "));
            assert.ok(!text.startsWith("#"), args.join(" "));
            assert.doesNotMatch(text, /\n##\s/);
            assert.doesNotMatch(text, /\.aidw\/AI_project\.md|\.aidw\/workflow\.md|\.aidw\/rules-canonical\.md/);
            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch {
                assert.fail(`Expected JSON output: ${args.join(" ")}`);
            }
            assertCompactJsonText(text, args.join(" "));
            assert.equal(parsed.schemaVersion, "runtime/v1", args.join(" "));
            assert.equal(parsed.interface, "cli", args.join(" "));

            if (args[0] === "context" && args[1] === "workset") {
                assert.ok(Array.isArray(parsed.workset.files));
                assert.ok(parsed.workset.files.length <= 10);
                assert.ok(Array.isArray(parsed.workset.entrypoints));
                assert.ok(parsed.workset.entrypoints.length <= 12);
                assert.ok(Array.isArray(parsed.workset.riskAreas));
                assert.ok(parsed.workset.riskAreas.length <= 10);
            }

            if (args[0] === "task" && args[1] === "prompt") {
                assert.ok(Array.isArray(parsed.task.scope));
                assert.ok(parsed.task.scope.length <= 16);
                assert.ok(Array.isArray(parsed.task.requirements));
                assert.ok(parsed.task.requirements.length <= 16);
                assert.ok(Array.isArray(parsed.task.acceptanceCriteria));
                assert.ok(parsed.task.acceptanceCriteria.length <= 16);
                assert.equal(parsed.task.testCommand?.includes("```"), false);
            }

            assert.ok(estimateTokenUnits(text) <= CONTEXT_BUDGET.maxApproxTokenUnits, args.join(" "));
        }
    });
});

test("runtime budget helper truncates oversized payloads deterministically", () => {
    const payload = {
        schemaVersion: "runtime/v1",
        z: "z".repeat(5000),
        a: Array.from({ length: 100 }, (_, index) => `item-${index}`),
        nested: {
            c: Array.from({ length: 100 }, (_, index) => index),
            b: "b".repeat(4000),
        },
    };

    const budgeted = budgetJsonPayload(payload, {
        maxArrayItems: 5,
        maxStringLength: 64,
        maxNestedDepth: 4,
        maxPayloadBytes: 700,
    });
    const budgetedText = serializeCompactJson(budgeted);
    const budgetedRepeat = budgetJsonPayload(payload, {
        maxArrayItems: 5,
        maxStringLength: 64,
        maxNestedDepth: 4,
        maxPayloadBytes: 700,
    });

    assert.ok(Buffer.byteLength(budgetedText, "utf8") <= 700);
    assert.deepEqual(Object.keys(budgeted), ["a", "nested", "schemaVersion", "z"]);
    assert.ok(Array.isArray(budgeted.a));
    assert.ok(budgeted.a.length <= 5);
    assert.ok(Array.isArray(budgeted.nested.c));
    assert.ok(budgeted.nested.c.length <= 5);
    assert.ok(budgeted.z.length <= 64);
    assert.equal(serializeCompactJson(budgetedRepeat), budgetedText);
});

test("runtime budget enforces approximate token units and drops optional sections first", () => {
    const payload = {
        schemaVersion: "runtime/v1",
        interface: "mcp",
        context: {
            summary: "summary".repeat(120),
            risks: Array.from({ length: 40 }, (_, index) => `risk-${index}`),
            files: Array.from({ length: 80 }, (_, index) => ({
                path: `src/feature/${String(index).padStart(3, "0")}.js`,
                description: "detail".repeat(30),
            })),
        },
        optional: {
            debug: "debug".repeat(200),
            notes: Array.from({ length: 40 }, (_, index) => `note-${index}`),
        },
    };

    const budgeted = budgetJsonPayload(payload, {
        maxPayloadBytes: 2400,
        maxApproxTokenUnits: 260,
        maxStringLength: 100,
        maxArrayItems: 10,
        maxObjectKeysPerSection: 8,
        optionalPaths: ["optional"],
    });
    const text = serializeCompactJson(budgeted).trim();

    assert.ok(Buffer.byteLength(text, "utf8") <= 2400);
    assert.ok(estimateTokenUnits(text) <= 260);
    assert.deepEqual(Object.keys(budgeted).sort(), ["context", "interface", "optional", "schemaVersion"]);
    assert.equal(Array.isArray(budgeted.optional), false);
    assert.equal(budgeted.optional, null);
});

test("oversize reduction preserves required runtime envelope and section keys", () => {
    const payload = {
        schemaVersion: "runtime/v1",
        interface: "mcp",
        kind: "task-prompt",
        task: {
            id: "T-001",
            title: "Very long title ".repeat(100),
            status: "todo",
            priority: "high",
            facts: {
                goal: "Goal ".repeat(200),
                scope: Array.from({ length: 100 }, (_, index) => `scope-${index}`),
            },
        },
        context: {
            entrypoints: Array.from({ length: 100 }, (_, index) => `entry-${index}`),
            riskAreas: Array.from({ length: 100 }, (_, index) => `risk-${index}`),
        },
    };

    const budgeted = budgetJsonPayload(payload, {
        maxPayloadBytes: 220,
        maxApproxTokenUnits: 80,
        maxStringLength: 40,
        maxArrayItems: 3,
        maxNestedDepth: 8,
    });

    assert.equal(budgeted.schemaVersion, "runtime/v1");
    assert.equal(typeof budgeted.interface, "string");
    assert.equal(typeof budgeted.kind, "string");
    assert.ok(Object.hasOwn(budgeted, "task"));
    assert.ok(Object.hasOwn(budgeted, "context"));
    assert.ok(Object.hasOwn(budgeted.task, "id"));
    assert.ok(Object.hasOwn(budgeted.task, "title"));
    assert.ok(Object.hasOwn(budgeted.task, "status"));
    assert.ok(Object.hasOwn(budgeted.task, "priority"));
});

test("extreme oversize payload returns minimal valid schema shape", () => {
    const payload = {
        schemaVersion: "runtime/v1",
        interface: "cli",
        kind: "context-workset",
        task: {
            id: "T-001",
            title: "x".repeat(10_000),
            status: "todo",
            priority: "high",
        },
        workset: {
            files: Array.from({ length: 1_000 }, (_, index) => ({
                path: `src/file-${index}.js`,
                description: "y".repeat(200),
            })),
        },
    };

    const budgeted = budgetJsonPayload(payload, {
        maxPayloadBytes: 64,
        maxApproxTokenUnits: 20,
        maxStringLength: 16,
        maxArrayItems: 1,
        maxNestedDepth: 8,
    });

    assert.equal(budgeted.schemaVersion, "runtime/v1");
    assert.equal(Object.hasOwn(budgeted, "interface"), true);
    assert.equal(Object.hasOwn(budgeted, "kind"), true);
    assert.equal(Object.hasOwn(budgeted, "task"), true);
    assert.equal(Object.hasOwn(budgeted, "workset"), true);
    assert.equal(Object.hasOwn(budgeted, "_truncation"), true);
    assert.equal(budgeted._truncation?.reduced, true);
    assert.equal(budgeted._truncation?.reason, "budget_limit");
});

test("context loop history stays bounded and deterministic", async () => {
    await withTempProject(async () => {
        await withMutedConsole(() => runInit());

        for (let index = 0; index < 80; index += 1) {
            appendLoopEvent({ type: "test", taskId: "T-001", command: `npm test -- ${index}`, exitCode: index % 3 === 0 ? 1 : 0 });
        }

        const events = listRecentLoopEvents({ limit: 999, maxBytes: 999999, taskId: "T-001" });
        assert.ok(events.length <= CONTEXT_BUDGET.maxLoopEvents);
        const timestamps = events.map((event) => String(event.at ?? ""));
        const sorted = [...timestamps].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
        assert.deepEqual(timestamps, sorted);
    });
});

test("README and package manifest reflect the hard slim surface", () => {
    const readme = fs.readFileSync(path.resolve(originalCwd, "README.md"), "utf-8");
    assert.match(readme, /Compact deterministic repository runtime for AI coding agents/);
    assert.match(readme, /repo-context-kit context brief/);
    assert.match(readme, /repo-context-kit-mcp --root <repo>/);
    assert.doesNotMatch(readme, /auto|bootstrap|hygiene|Local UI|task new|github auth|runtime snapshot/);

    const pkg = JSON.parse(fs.readFileSync(path.resolve(originalCwd, "package.json"), "utf-8"));
    assert.equal(pkg.bin["repo-context-kit"], "bin/cli.js");
    assert.equal(pkg.bin["repo-context-kit-mcp"], "bin/mcp.js");
    assert.ok(!pkg.files.includes("site"));
});

test("legacy markdown builders are not exported and active JSON-first exports are intact", () => {
    // context.js: dead builders removed, active exports intact
    assert.equal(typeof contextModule.buildWorksetContext, "function", "buildWorksetContext must remain (used by virtual-task)");
    assert.equal(typeof contextModule.runContext, "function", "runContext must remain");
    assert.equal(contextModule.buildNextTask, undefined, "buildNextTask was dead code and must not be exported");

    // task.js: dead builders removed, active exports intact
    assert.equal(typeof taskModule.buildTaskPrompt, "function", "buildTaskPrompt must remain (used by virtual-task)");
    assert.equal(typeof taskModule.runTask, "function", "runTask must remain");
    assert.equal(taskModule.buildTaskPrDescription, undefined, "buildTaskPrDescription was dead code and must not be exported");
    assert.equal(taskModule.buildTaskChecklist, undefined, "buildTaskChecklist was dead code and must not be exported");
});

test("computeContextFreshness does not throw and returns a valid score shape (no indexes exist)", async () => {
    // Regression: scaffoldPlanPath was undefined, causing ReferenceError on any call.
    await withTempProject(async () => {
        await withMutedConsole(() => runInit());
        // No scan run — indexes do not exist. freshness should handle that gracefully.
        let result;
        assert.doesNotThrow(() => {
            result = computeContextFreshness();
        });
        assert.equal(typeof result.score, "number");
        assert.ok(result.score >= 0 && result.score <= 100);
        assert.ok(typeof result.scanStale === "boolean");
        assert.ok(Array.isArray(result.signals));
        assert.ok(Array.isArray(result.suggestedActions));
        // Without indexes, scanStale must be true
        assert.equal(result.scanStale, true);
        // scaffold_plan_outdated signal must never be triggered (path is null, feature not wired)
        const scaffoldSignal = result.signals.find((s) => s.id === "scaffold_plan_outdated");
        assert.equal(scaffoldSignal, undefined, "scaffold_plan_outdated must not be triggered when path is null");
    });
});

test("computeContextFreshness returns fresh state after scan and stale state after index removal", async () => {
    await withTempProject(async () => {
        await withMutedConsole(() => runInit());
        writeFile("package.json", JSON.stringify({ name: "freshness-test", version: "0.0.0", type: "module" }, null, 4) + "\n");
        writeFile("src/main.js", "export function main() { return 1; }\n");
        writeFile("task/task.md", minimalRegistry());
        writeFile("task/T-001-core-runtime.md", minimalTask());
        await withMutedConsole(() => runScan());

        // After scan: freshness check must not throw
        let fresh;
        assert.doesNotThrow(() => {
            fresh = computeContextFreshness();
        });
        assert.equal(typeof fresh.score, "number");
        assert.ok(fresh.score >= 0 && fresh.score <= 100);
        // scaffold_plan_outdated must never appear as triggered
        const scaffoldSignal = fresh.signals.find((s) => s.id === "scaffold_plan_outdated");
        assert.equal(scaffoldSignal, undefined, "scaffold_plan_outdated must not be triggered after scan");

        // Remove the summary index to force stale state
        const summaryPath = path.join(process.cwd(), ".aidw/index/summary.json");
        if (fs.existsSync(summaryPath)) {
            fs.unlinkSync(summaryPath);
        }
        let stale;
        assert.doesNotThrow(() => {
            stale = computeContextFreshness();
        });
        assert.equal(stale.scanStale, true, "scanStale must be true when summary.json is missing");
    });
});

test("context-compression does not export computeRelevanceScore or filterRelevantFiles (dead duplicates removed)", () => {
    assert.equal(compressionModule.computeRelevanceScore, undefined,
        "computeRelevanceScore was a dead duplicate with incompatible signature and must not be exported from context-compression");
    assert.equal(compressionModule.filterRelevantFiles, undefined,
        "filterRelevantFiles was a dead duplicate with incompatible argument order and must not be exported from context-compression");
    // Active exports must remain
    assert.equal(typeof compressionModule.computeContextHash, "function");
    assert.equal(typeof compressionModule.scoreContextCacheability, "function");
    assert.equal(typeof compressionModule.detectSemanticDuplication, "function");
    assert.equal(typeof compressionModule.normalizeRuleText, "function");
    assert.equal(typeof compressionModule.buildEscalationDecision, "function");
    assert.equal(typeof compressionModule.buildContextCompressionMetrics, "function");
});

test("computeRelevanceScore from context-relevance is deterministic (same inputs produce same output)", () => {
    const context = { allFilePaths: ["src/a.js", "src/b.js"], recentFiles: [] };
    const r1 = computeRelevanceScore("src/a.js", "src/b.js", context);
    const r2 = computeRelevanceScore("src/a.js", "src/b.js", context);
    assert.equal(typeof r1.score, "number");
    assert.equal(r1.score, r2.score, "score must be deterministic");
    assert.deepEqual(r1.reasons, r2.reasons, "reasons must be deterministic");
    assert.equal(r1.distance, r2.distance, "distance must be deterministic");
});

test("rankFilesForContext produces stable order for equal-score files", () => {
    const context = { allFilePaths: [], recentFiles: [] };
    const files = ["src/z.js", "src/a.js", "src/m.js"];
    const run1 = rankFilesForContext("src/source.js", [...files], context).map((r) => r.file);
    const run2 = rankFilesForContext("src/source.js", [...files.slice().reverse()], context).map((r) => r.file);
    assert.deepEqual(run1, run2, "equal-score files must be sorted by path as stable tie-breaker");
});

test("inert flags removed: runContext does not parse --manifest, --verbose, --raw-loop, --summary-json, --no-cache", async () => {
    // These flags were parsed but never passed to any active JSON-first output path.
    // Passing them now must produce the same output as passing none.
    // We confirm by checking that context help no longer advertises them.
    const resultPlain = await contextModule.runContext(["help"]);
    assert.equal(resultPlain.output, null); // help returns null output by spec

    // Help text must NOT advertise the removed dead flags
    const consoleLogs = [];
    const origLog = console.log;
    console.log = (...args) => consoleLogs.push(args.join(" "));
    try {
        await contextModule.runContext(["help"]);
    } finally {
        console.log = origLog;
    }
    const helpText = consoleLogs.join("\n");
    assert.ok(!helpText.includes("--manifest"), "--manifest must not appear in context help (dead flag)");
    assert.ok(!helpText.includes("--verbose"), "--verbose must not appear in context help (dead flag)");
    assert.ok(!helpText.includes("--summary-json"), "--summary-json must not appear in context help (dead flag)");
    assert.ok(!helpText.includes("--no-cache"), "--no-cache must not appear in context help (dead flag)");
    // Active flags must remain in help
    assert.ok(helpText.includes("--compact"), "--compact must remain in context help (active)");
    assert.ok(helpText.includes("--full"), "--full must remain in context help (active)");
});

test("inert flags removed: runTask does not advertise --compact, --full-detail, --full-workset in help", async () => {
    const consoleLogs = [];
    const origLog = console.log;
    console.log = (...args) => consoleLogs.push(args.join(" "));
    try {
        await taskModule.runTask(["help"]);
    } finally {
        console.log = origLog;
    }
    const helpText = consoleLogs.join("\n");
    assert.ok(!helpText.includes("--compact"), "--compact must not appear in task help (dead flag)");
    assert.ok(!helpText.includes("--full-detail"), "--full-detail must not appear in task help (dead flag)");
    assert.ok(!helpText.includes("--full-workset"), "--full-workset must not appear in task help (dead flag)");
    assert.ok(!helpText.includes("--manifest"), "--manifest must not appear in task help (dead flag)");
    assert.ok(!helpText.includes("--verbose"), "--verbose must not appear in task help (dead flag)");
    // Active flag must remain
    assert.ok(helpText.includes("--deep"), "--deep must remain in task help (active)");
});
