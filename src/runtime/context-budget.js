import { stablePathCompare, stableStringCompare } from "./stable-sort.js";

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function toPositiveInteger(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        return fallback;
    }
    return Math.floor(number);
}

function truncateStringByBytes(text, maxBytes) {
    const value = String(text ?? "");
    const limit = Math.max(0, toPositiveInteger(maxBytes, 0));
    if (limit === 0 || Buffer.byteLength(value, "utf8") <= limit) {
        return value;
    }

    let end = value.length;
    while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > limit) {
        end -= 1;
    }

    return value.slice(0, Math.max(0, end)).trimEnd();
}

export const CONTEXT_BUDGET = Object.freeze({
    maxWorksetFiles: 12,
    maxSummaries: 3,
    maxSymbols: 30,
    maxChecklistItems: 16,
    maxTaskNotes: 8,
    maxRisks: 10,
    maxStringLength: 240,
    maxPayloadBytes: 16_384,
    maxContextSections: 8,
    maxArraysPerResponse: 12,
    maxNestedDepth: 6,
    context: Object.freeze({
        brief: Object.freeze({ maxChars: 8000 }),
        "next-task": Object.freeze({ maxChars: 12000, maxDependencySummaries: 3 }),
        workset: Object.freeze({
            maxChars: 16000,
            maxRelatedFiles: 12,
            maxRelatedSymbols: 30,
            maxDependencySummaries: 3,
            maxFileSummaryFiles: 6,
            maxFileSummaryChars: 2400,
        }),
        "workset-deep": Object.freeze({
            maxChars: 24000,
            maxRelatedFiles: 24,
            maxRelatedSymbols: 60,
            maxDependencySummaries: 3,
            maxFileSummaryFiles: 10,
            maxFileSummaryChars: 3600,
        }),
        "workset-digest": Object.freeze({
            maxChars: 7000,
            maxRelatedFiles: 6,
            maxRelatedSymbols: 8,
            maxDependencySummaries: 3,
            maxFileSummaryFiles: 4,
            maxFileSummaryChars: 1200,
        }),
    }),
    task: Object.freeze({
        prompt: Object.freeze({ default: 20000, deep: 28000 }),
        checklist: Object.freeze({ default: 14000, deep: 20000 }),
        pr: Object.freeze({ default: 14000, deep: 20000 }),
    }),
});

function normalizeArray(value, maxItems) {
    return Array.isArray(value) ? value.slice(0, maxItems) : [];
}

function budgetValue(value, options, pathParts = [], depth = 0) {
    const maxStringLength = toPositiveInteger(options.maxStringLength, CONTEXT_BUDGET.maxStringLength);
    const maxArrayItems = toPositiveInteger(options.maxArrayItems, CONTEXT_BUDGET.maxArraysPerResponse);
    const maxNestedDepth = toPositiveInteger(options.maxNestedDepth, CONTEXT_BUDGET.maxNestedDepth);

    if (value === undefined) {
        throw new Error(`budget: undefined at ${pathParts.join(".") || "(root)"}`);
    }
    if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
        throw new Error(`budget: unsupported type ${typeof value} at ${pathParts.join(".") || "(root)"}`);
    }
    if (value == null) {
        return null;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`budget: non-finite number at ${pathParts.join(".") || "(root)"}`);
        }
        return value;
    }
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        return truncateStringByBytes(value, maxStringLength);
    }
    if (depth >= maxNestedDepth) {
        return Array.isArray(value) ? [] : null;
    }
    if (Array.isArray(value)) {
        return value.slice(0, maxArrayItems).map((item, index) => budgetValue(item, options, [...pathParts, String(index)], depth + 1));
    }
    if (isPlainObject(value)) {
        const keys = Object.keys(value).sort(stableStringCompare);
        const out = {};
        for (const key of keys) {
            const next = value[key];
            if (next === undefined) continue;
            out[key] = budgetValue(next, options, [...pathParts, key], depth + 1);
        }
        return out;
    }
    throw new Error(`budget: unsupported object type at ${pathParts.join(".") || "(root)"}`);
}

function collectBudgetNodes(value, pathParts = [], nodes = [], parent = null, key = null) {
    if (value == null || typeof value === "number" || typeof value === "boolean") {
        return nodes;
    }
    if (typeof value === "string") {
        nodes.push({ type: "string", parent, key, path: pathParts.join("/"), size: Buffer.byteLength(value, "utf8") });
        return nodes;
    }
    if (Array.isArray(value)) {
        nodes.push({ type: "array", parent, key, path: pathParts.join("/"), size: value.length });
        value.forEach((item, index) => collectBudgetNodes(item, [...pathParts, String(index)], nodes, value, index));
        return nodes;
    }
    if (isPlainObject(value)) {
        for (const objectKey of Object.keys(value).sort(stableStringCompare)) {
            collectBudgetNodes(value[objectKey], [...pathParts, objectKey], nodes, value, objectKey);
        }
        return nodes;
    }
    return nodes;
}

function reduceBudgetNode(node) {
    if (!node || !node.parent) {
        return false;
    }
    if (node.type === "array") {
        const current = node.parent[node.key];
        if (!Array.isArray(current) || current.length <= 1) {
            return false;
        }
        current.pop();
        return true;
    }
    if (node.type === "string") {
        const current = String(node.parent[node.key] ?? "");
        if (current.length <= 16) {
            return false;
        }
        const next = truncateStringByBytes(current, Math.max(16, Math.floor(Buffer.byteLength(current, "utf8") * 0.8)));
        if (next === current) {
            return false;
        }
        node.parent[node.key] = next;
        return true;
    }
    return false;
}

export function limitArray(values, maxItems = CONTEXT_BUDGET.maxArraysPerResponse) {
    return normalizeArray(values, toPositiveInteger(maxItems, CONTEXT_BUDGET.maxArraysPerResponse));
}

export function limitString(value, maxBytes = CONTEXT_BUDGET.maxStringLength) {
    return truncateStringByBytes(value, maxBytes);
}

export function budgetJsonPayload(payload, options = {}) {
    const normalized = budgetValue(payload, options);
    const maxPayloadBytes = toPositiveInteger(options.maxPayloadBytes, CONTEXT_BUDGET.maxPayloadBytes);
    let text = JSON.stringify(normalized);
    if (Buffer.byteLength(text, "utf8") <= maxPayloadBytes) {
        return normalized;
    }

    const budgeted = normalized;
    for (let iteration = 0; iteration < 64; iteration += 1) {
        const nodes = collectBudgetNodes(budgeted);
        nodes.sort((a, b) => b.size - a.size || (a.type === b.type ? stablePathCompare(a.path, b.path) : a.type === "array" ? -1 : 1));
        let changed = false;
        for (const node of nodes) {
            if (reduceBudgetNode(node)) {
                changed = true;
                break;
            }
        }
        if (!changed) {
            break;
        }
        text = JSON.stringify(budgeted);
        if (Buffer.byteLength(text, "utf8") <= maxPayloadBytes) {
            return budgeted;
        }
    }

    return budgeted;
}
