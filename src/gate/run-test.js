import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { parseTaskRegistry } from "../scan/task-registry.js";
import { validateGate } from "./state.js";

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

export async function runTaskTestThroughGate({ taskId, token }) {
    const gating = validateGate({ taskId, token, requireTestsConfirmed: true });
    if (!gating.ok) {
        return { ok: false, exitCode: 1, error: gating.error, command: null };
    }

    const { error, command } = getTaskTestCommand(taskId);
    if (error) {
        return { ok: false, exitCode: 1, error, command: null };
    }

    console.log(`Running: ${command}`);
    const exitCode = await runAllowedCommand(command);
    return { ok: exitCode === 0, exitCode, error: null, command };
}

