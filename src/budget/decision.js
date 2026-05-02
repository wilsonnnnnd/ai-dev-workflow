function normalizeList(values) {
    return (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean);
}

export function formatBudgetDecisionMarkdown(decision, options = {}) {
    if (!decision || !decision.mode || !decision.decision) {
        return "";
    }

    const warningsCount = Number.isFinite(Number(options.warningsCount))
        ? Number(options.warningsCount)
        : null;

    const upgrades = normalizeList(decision.upgradesApplied);
    const reasonCodes = normalizeList(decision.reasonCodes);
    const evidence = normalizeList(decision.evidence);

    if (warningsCount != null) {
        evidence.push(`warnings_count=${warningsCount}`);
        if (warningsCount > 0 && !reasonCodes.includes("WARNINGS_PRESENT")) {
            reasonCodes.push("WARNINGS_PRESENT");
        }
    }

    const upgradesText = upgrades.length ? upgrades.join(", ") : "none";
    const reasonsText = reasonCodes.length ? reasonCodes.join(", ") : "none";
    const evidenceLines = evidence.length
        ? evidence.map((line) => `  - ${line}`).join("\n")
        : "  - none";

    return [
        "## Budget Decision",
        "",
        `- mode: ${decision.mode}`,
        `- decision: ${decision.decision}`,
        `- upgrades_applied: ${upgradesText}`,
        `- reason_codes: ${reasonsText}`,
        "- evidence:",
        evidenceLines,
        "- override:",
        "  - use --budget off to disable auto budget",
        "  - use --budget full for explicit full output",
    ].join("\n");
}

export function buildBudgetDecisionEvent(decision, options = {}) {
    if (!decision || !decision.mode || !decision.decision) {
        return null;
    }

    const warningsCount = Number.isFinite(Number(options.warningsCount))
        ? Number(options.warningsCount)
        : null;

    const reasonCodes = normalizeList(decision.reasonCodes);
    const evidence = normalizeList(decision.evidence);
    const upgradesApplied = normalizeList(decision.upgradesApplied);

    if (warningsCount != null) {
        evidence.push(`warnings_count=${warningsCount}`);
        if (warningsCount > 0 && !reasonCodes.includes("WARNINGS_PRESENT")) {
            reasonCodes.push("WARNINGS_PRESENT");
        }
    }

    const payload = {
        type: "budget_decision",
        mode: decision.mode,
        decision: decision.decision,
        reasonCodes,
        evidence,
    };

    if (upgradesApplied.length) {
        payload.upgradesApplied = upgradesApplied;
    }

    if (options.taskId) {
        payload.taskId = String(options.taskId).trim().toUpperCase();
    }

    if (options.command) {
        payload.command = String(options.command);
    }

    return payload;
}

