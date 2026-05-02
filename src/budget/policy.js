const VALID_BUDGET_MODES = new Set(["off", "auto", "full"]);

function normalizeBudgetMode(value) {
    const text = String(value ?? "").trim().toLowerCase();
    if (!text) {
        return null;
    }
    return VALID_BUDGET_MODES.has(text) ? text : null;
}

export function resolveBudgetMode(args = [], env = process.env) {
    const argv = Array.isArray(args) ? args : [];

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === "--budget") {
            return normalizeBudgetMode(argv[index + 1]) ?? "off";
        }
        if (typeof token === "string" && token.startsWith("--budget=")) {
            return normalizeBudgetMode(token.slice("--budget=".length)) ?? "off";
        }
    }

    const fromEnv = normalizeBudgetMode(env?.REPO_CONTEXT_KIT_BUDGET);
    return fromEnv ?? "off";
}

export function isBudgetEnabled(mode) {
    return mode === "auto" || mode === "full";
}

