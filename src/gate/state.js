import fs from "fs";
import path from "path";

const STATE_DIR = ".aidw";
const STATE_FILE = "confirmation-gate.json";
const PROTOCOL = "confirmation-protocol/v1";

function getStatePath(cwd = process.cwd()) {
    return path.resolve(cwd, STATE_DIR, STATE_FILE);
}

export function loadGateState(cwd = process.cwd()) {
    const filePath = getStatePath(cwd);

    if (!fs.existsSync(filePath)) {
        return {
            protocol: PROTOCOL,
            taskConfirmed: false,
            testsConfirmed: false,
            updatedAt: null,
        };
    }

    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);

        return {
            protocol: parsed?.protocol || PROTOCOL,
            taskConfirmed: Boolean(parsed?.taskConfirmed),
            testsConfirmed: Boolean(parsed?.testsConfirmed),
            updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : null,
        };
    } catch {
        return {
            protocol: PROTOCOL,
            taskConfirmed: false,
            testsConfirmed: false,
            updatedAt: null,
        };
    }
}

export function saveGateState(nextState, cwd = process.cwd()) {
    const dirPath = path.resolve(cwd, STATE_DIR);
    const filePath = getStatePath(cwd);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(nextState, null, 2) + "\n", "utf-8");
    return filePath;
}

export function setTaskConfirmed(value, cwd = process.cwd()) {
    const prev = loadGateState(cwd);
    const next = {
        protocol: PROTOCOL,
        taskConfirmed: Boolean(value),
        testsConfirmed: Boolean(value) ? Boolean(prev.testsConfirmed) : false,
        updatedAt: new Date().toISOString(),
    };
    const filePath = saveGateState(next, cwd);
    return { filePath, state: next };
}

export function setTestsConfirmed(value, cwd = process.cwd()) {
    const prev = loadGateState(cwd);
    const next = {
        protocol: PROTOCOL,
        taskConfirmed: Boolean(prev.taskConfirmed),
        testsConfirmed: Boolean(value),
        updatedAt: new Date().toISOString(),
    };
    const filePath = saveGateState(next, cwd);
    return { filePath, state: next };
}

export function resetGateState(cwd = process.cwd()) {
    const next = {
        protocol: PROTOCOL,
        taskConfirmed: false,
        testsConfirmed: false,
        updatedAt: new Date().toISOString(),
    };
    const filePath = saveGateState(next, cwd);
    return { filePath, state: next };
}

