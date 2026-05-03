import fs from "fs";
import path from "path";

const STATE_DIR = ".aidw";
const STATE_FILE = "executor-state.json";
const PROTOCOL = "semi-auto-executor/v1";

function getStatePath(cwd = process.cwd()) {
    return path.resolve(cwd, STATE_DIR, STATE_FILE);
}

function toIso(value) {
    return value instanceof Date ? value.toISOString() : null;
}

function buildDefaultState(now = new Date()) {
    return {
        protocol: PROTOCOL,
        activeTaskId: null,
        phase: "idle",
        pauseId: null,
        pauseType: null,
        message: null,
        createdAt: toIso(now),
        updatedAt: toIso(now),
        completedTasks: [],
        blockedReason: null,
        lastSyncedTestAt: null,
        lastTestExitCode: null,
        lastTestCommand: null,
    };
}

function normalizeLoadedState(parsed) {
    const now = new Date();
    const completedTasks = Array.isArray(parsed?.completedTasks)
        ? parsed.completedTasks.map((value) => String(value ?? "").trim()).filter(Boolean)
        : [];
    return {
        protocol: typeof parsed?.protocol === "string" ? parsed.protocol : PROTOCOL,
        activeTaskId: typeof parsed?.activeTaskId === "string" ? parsed.activeTaskId : null,
        phase: typeof parsed?.phase === "string" ? parsed.phase : "idle",
        pauseId: typeof parsed?.pauseId === "string" ? parsed.pauseId : null,
        pauseType: typeof parsed?.pauseType === "string" ? parsed.pauseType : null,
        message: typeof parsed?.message === "string" ? parsed.message : null,
        createdAt: typeof parsed?.createdAt === "string" ? parsed.createdAt : toIso(now),
        updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : toIso(now),
        completedTasks,
        blockedReason: typeof parsed?.blockedReason === "string" ? parsed.blockedReason : null,
        lastSyncedTestAt: typeof parsed?.lastSyncedTestAt === "string" ? parsed.lastSyncedTestAt : null,
        lastTestExitCode: typeof parsed?.lastTestExitCode === "number" ? parsed.lastTestExitCode : null,
        lastTestCommand: typeof parsed?.lastTestCommand === "string" ? parsed.lastTestCommand : null,
    };
}

export function loadExecutorState(cwd = process.cwd()) {
    const filePath = getStatePath(cwd);
    if (!fs.existsSync(filePath)) {
        return buildDefaultState();
    }
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        return normalizeLoadedState(parsed);
    } catch {
        return buildDefaultState();
    }
}

export function saveExecutorState(nextState, cwd = process.cwd()) {
    const dirPath = path.resolve(cwd, STATE_DIR);
    const filePath = getStatePath(cwd);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(nextState, null, 2) + "\n", "utf-8");
    return filePath;
}

export function resetExecutorState(cwd = process.cwd()) {
    const now = new Date();
    const next = buildDefaultState(now);
    const filePath = saveExecutorState(next, cwd);
    return { filePath, state: next };
}

export function updateExecutorState(patch, cwd = process.cwd()) {
    const prev = loadExecutorState(cwd);
    const now = new Date();
    const next = normalizeLoadedState({
        ...prev,
        ...patch,
        updatedAt: toIso(now),
        createdAt: prev.createdAt ?? toIso(now),
    });
    const filePath = saveExecutorState(next, cwd);
    return { filePath, state: next };
}

