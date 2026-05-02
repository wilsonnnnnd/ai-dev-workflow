const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

function getWorkspaceRoot() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder?.uri?.fsPath ?? null;
}

function getNpxCommand() {
    return process.platform === "win32" ? "npx.cmd" : "npx";
}

function runNpx(args, cwd) {
    return new Promise((resolve) => {
        const child = cp.spawn(getNpxCommand(), ["repo-context-kit", ...args], {
            cwd,
            shell: false,
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf-8");
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf-8");
        });
        child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
        child.on("error", (error) => resolve({ code: 1, stdout, stderr: String(error?.message ?? error) }));
    });
}

function parseJsonOutput(stdout) {
    const text = String(stdout ?? "").trim();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function listTaskIds(cwd) {
    const taskDir = path.join(cwd, "task");
    if (!fs.existsSync(taskDir)) {
        return [];
    }
    const entries = fs.readdirSync(taskDir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name.match(/^(T-\d{3})\b/i)?.[1]?.toUpperCase())
        .filter(Boolean)
        .sort();
}

async function ensureWorkspaceRoot() {
    const root = getWorkspaceRoot();
    if (!root) {
        vscode.window.showErrorMessage("No workspace folder is open.");
        return null;
    }
    return root;
}

async function showResult(title, result) {
    const text = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join("\n\n").trim();
    if (result.code === 0) {
        vscode.window.showInformationMessage(title);
    } else {
        vscode.window.showErrorMessage(`${title} (exit ${result.code})`);
    }
    if (text) {
        const doc = await vscode.workspace.openTextDocument({ content: text, language: "markdown" });
        await vscode.window.showTextDocument(doc, { preview: true });
    }
}

async function pickTaskId(cwd) {
    const ids = listTaskIds(cwd);
    if (ids.length === 0) {
        vscode.window.showErrorMessage('No task files found under "task/".');
        return null;
    }
    const picked = await vscode.window.showQuickPick(ids, {
        placeHolder: "Select a task id (T-###)",
        canPickMany: false,
    });
    return picked ?? null;
}

function tokenKey(taskId) {
    return `repoContextKitGate.token.${taskId}`;
}

function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("repoContextKitGate.status", async () => {
            const cwd = await ensureWorkspaceRoot();
            if (!cwd) return;
            const result = await runNpx(["gate", "status"], cwd);
            await showResult("Gate status", result);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("repoContextKitGate.reset", async () => {
            const cwd = await ensureWorkspaceRoot();
            if (!cwd) return;
            const result = await runNpx(["gate", "reset"], cwd);
            await showResult("Gate reset", result);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("repoContextKitGate.confirmTask", async () => {
            const cwd = await ensureWorkspaceRoot();
            if (!cwd) return;
            const taskId = await pickTaskId(cwd);
            if (!taskId) return;
            const result = await runNpx(["gate", "confirm", "task", taskId, "--json"], cwd);
            const parsed = parseJsonOutput(result.stdout);
            if (result.code === 0 && parsed?.ok && parsed?.token) {
                await context.globalState.update(tokenKey(taskId), parsed.token);
                vscode.window.showInformationMessage(`Task confirmed: ${taskId}`);
                return;
            }
            await showResult(`Confirm task ${taskId}`, result);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("repoContextKitGate.confirmTests", async () => {
            const cwd = await ensureWorkspaceRoot();
            if (!cwd) return;
            const taskId = await pickTaskId(cwd);
            if (!taskId) return;
            const token = context.globalState.get(tokenKey(taskId));
            if (!token) {
                vscode.window.showErrorMessage(`Missing gate token for ${taskId}. Run "Confirm Task" first.`);
                return;
            }
            const result = await runNpx(["gate", "confirm", "tests", taskId, "--json"], cwd);
            const parsed = parseJsonOutput(result.stdout);
            if (result.code === 0 && parsed?.ok) {
                if (parsed?.token) {
                    await context.globalState.update(tokenKey(taskId), parsed.token);
                }
                vscode.window.showInformationMessage(`Tests confirmed: ${taskId}`);
                return;
            }
            await showResult(`Confirm tests ${taskId}`, result);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("repoContextKitGate.runTaskTest", async () => {
            const cwd = await ensureWorkspaceRoot();
            if (!cwd) return;
            const taskId = await pickTaskId(cwd);
            if (!taskId) return;
            const token = context.globalState.get(tokenKey(taskId));
            if (!token) {
                vscode.window.showErrorMessage(`Missing gate token for ${taskId}. Run "Confirm Task" first.`);
                return;
            }
            const result = await runNpx(["gate", "run-test", taskId, "--token", token], cwd);
            await showResult(`Run test for ${taskId}`, result);
        }),
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
