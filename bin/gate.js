#!/usr/bin/env node
import { spawn } from "child_process";
import path from "path";
import { existsSync, readFileSync } from "fs";
import { parseTaskRegistry } from "../src/scan/task-registry.js";
import {
    loadGateState,
    resetGateState,
    setTaskConfirmed,
    setTestsConfirmed,
} from "../src/gate/state.js";

const ALLOWED_TEST_COMMANDS = new Set(["npm test", "pnpm test", "yarn test", "pytest"]);

function extractSection(content, heading) {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
        `(?:^|\\n)##\\s+${escapedHeading}\\s*\\n(?<body>[\\s\\S]*?)(?=\\n##\\s|$)`,
        "i",
    );
    const match = content.match(regex);

    return match?.groups?.body?.trim() ?? "";
}

function normalizeCommand(command) {
    return String(command ?? "").trim().replace(/\s+/g, " ");
}

function printGateStatus(state) {
    console.log([
        "# Confirmation Gate",
        "",
        `- protocol: ${state.protocol}`,
        `- taskConfirmed: ${state.taskConfirmed ? "true" : "false"}`,
        `- testsConfirmed: ${state.testsConfirmed ? "true" : "false"}`,
        `- updatedAt: ${state.updatedAt ?? "-"}`,
        "",
        "## Effective Gating",
        "",
        `- allow_file_edits: ${state.taskConfirmed ? "true" : "false"}`,
        `- allow_commands: ${state.testsConfirmed ? "true" : "false"}`,
    ].join("\n"));
}

function usage() {
    console.log(`Usage:
  repo-context-kit gate status
  repo-context-kit gate reset
  repo-context-kit gate confirm task
  repo-context-kit gate confirm tests
  repo-context-kit gate run-test <taskId>
`);
}

function resolveTaskFile(taskId) {
    const registry = parseTaskRegistry();
    const task = registry.tasks.find((entry) => entry.id?.toLowerCase() === taskId.toLowerCase()) ?? null;

    if (!task) {
        return { error: `Task not found: ${taskId}`, file: null };
    }

    if (!task.file) {
        return { error: `Task ${taskId} has no file entry in task/task.md`, file: null };
    }

    const filePath = path.resolve(process.cwd(), task.file);
    if (!existsSync(filePath)) {
        return { error: `Task file does not exist: ${task.file}`, file: null };
    }

    return { error: null, file: filePath };
}

function getTaskTestCommand(taskId) {
    const { error, file } = resolveTaskFile(taskId);
    if (error) {
        return { error, command: null };
    }

    const content = readFileSync(file, "utf-8");
    const raw = extractSection(content, "Test Command");

    if (!raw) {
        return { error: `Task ${taskId} is missing a "## Test Command" section.`, command: null };
    }

    const fencedMatch = raw.match(/```(?:bash)?\s*\n([\s\S]*?)\n```/i);
    const command = normalizeCommand(fencedMatch?.[1] ?? raw.split("\n")[0]);

    if (!command) {
        return { error: `Task ${taskId} has an empty test command.`, command: null };
    }

    if (!ALLOWED_TEST_COMMANDS.has(command)) {
        return {
            error: `Unsupported test command for safety: "${command}". Allowed: ${[...ALLOWED_TEST_COMMANDS].join(", ")}.`,
            command: null,
        };
    }

    return { error: null, command };
}

async function runAllowedCommand(command) {
    return new Promise((resolve) => {
        const child = spawn(command, {
            stdio: "inherit",
            shell: true,
            windowsHide: true,
        });

        child.on("close", (code) => resolve(code ?? 1));
        child.on("error", () => resolve(1));
    });
}

export async function runGate(args = []) {
    const subcommand = args[0];

    if (!subcommand || subcommand === "help" || subcommand === "--help") {
        usage();
        return;
    }

    if (subcommand === "status") {
        printGateStatus(loadGateState());
        return;
    }

    if (subcommand === "reset") {
        const { filePath, state } = resetGateState();
        console.log(`✔ Gate reset: ${path.relative(process.cwd(), filePath).replaceAll("\\", "/")}`);
        printGateStatus(state);
        return;
    }

    if (subcommand === "confirm") {
        const target = args[1];

        if (target === "task") {
            const { filePath, state } = setTaskConfirmed(true);
            console.log(`✔ Task confirmed: ${path.relative(process.cwd(), filePath).replaceAll("\\", "/")}`);
            printGateStatus(state);
            return;
        }

        if (target === "tests") {
            const current = loadGateState();
            if (!current.taskConfirmed) {
                console.error("Task must be confirmed before confirming tests.");
                process.exitCode = 1;
                return;
            }
            const { filePath, state } = setTestsConfirmed(true);
            console.log(`✔ Tests confirmed: ${path.relative(process.cwd(), filePath).replaceAll("\\", "/")}`);
            printGateStatus(state);
            return;
        }

        console.error("Unknown confirm target.");
        usage();
        process.exitCode = 1;
        return;
    }

    if (subcommand === "run-test") {
        const taskId = args[1];
        if (!taskId) {
            console.error("Missing task id.");
            usage();
            process.exitCode = 1;
            return;
        }

        const gate = loadGateState();
        if (!gate.testsConfirmed) {
            console.error("Tests are not confirmed. Run: repo-context-kit gate confirm tests");
            process.exitCode = 1;
            return;
        }

        const { error, command } = getTaskTestCommand(taskId);
        if (error) {
            console.error(error);
            process.exitCode = 1;
            return;
        }

        console.log(`Running: ${command}`);
        const code = await runAllowedCommand(command);
        process.exitCode = code;
        return;
    }

    console.error("Unknown gate command.");
    usage();
    process.exitCode = 1;
}

