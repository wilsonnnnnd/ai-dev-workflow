import { serializeJson } from "../src/runtime/serialize.js";

export function getFlag(args, flag) {
    return Array.isArray(args) && args.includes(flag);
}

export function stripFlag(args, flag) {
    const list = Array.isArray(args) ? args : [];
    return list.filter((arg) => arg !== flag);
}

export function getArgValue(args, name) {
    const list = Array.isArray(args) ? args : [];
    const index = list.indexOf(name);
    if (index === -1) return null;
    const value = list[index + 1];
    if (!value || value.startsWith("--")) return null;
    return value;
}

export function pickCommand(args, defaultCommand = null) {
    const list = Array.isArray(args) ? args : [];
    return list.find((arg) => !String(arg ?? "").startsWith("--")) ?? defaultCommand;
}

export function printUsageAndExit(usageText, { exitCode = 1, stream = "stderr" } = {}) {
    const out = stream === "stdout" ? console.log : console.error;
    out(String(usageText ?? "").trimEnd());
    process.exitCode = exitCode;
}

export function emitJson(data, { indent = 2 } = {}) {
    const n = Number.isFinite(Number(indent)) ? Number(indent) : 2;
    console.log(JSON.stringify(data, null, n));
}

export function emitStableJson(data, { indent = 4 } = {}) {
    console.log(serializeJson(data, { indent }));
}

