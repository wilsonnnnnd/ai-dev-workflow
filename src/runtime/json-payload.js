import fs from "node:fs";

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

export function readJsonPayload(source, { missingPathError = "path is required" } = {}) {
    if (source && typeof source === "object") {
        return source;
    }
    if (typeof source === "string" && source.trim() === "-") {
        const raw = fs.readFileSync(0, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed;
    }
    const filePath = String(source ?? "").trim();
    if (!filePath) {
        throw new Error(String(missingPathError ?? "path is required"));
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed;
}

export function pickPlanObject(payload, { key = "plan", required = true } = {}) {
    const k = String(key ?? "plan").trim() || "plan";
    const plan = isPlainObject(payload?.[k]) ? payload[k] : payload;
    if (required && !isPlainObject(plan)) {
        throw new Error("plan must be an object");
    }
    return plan;
}

