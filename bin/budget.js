#!/usr/bin/env node
import { pathToFileURL } from "url";
import path from "path";
import { resolveBudgetMode } from "../src/budget/policy.js";

function usage() {
    console.log(`Usage:
  repo-context-kit budget show
`);
}

function normalizeRawEnv(value) {
    const text = String(value ?? "").trim();
    return text || null;
}

export async function runBudget(args = [], env = process.env) {
    const subcommand = args.find((arg) => !arg.startsWith("--")) ?? "show";

    if (!subcommand || subcommand === "help" || subcommand === "--help") {
        usage();
        return { output: null };
    }

    if (subcommand !== "show") {
        console.error("Unknown budget command.");
        usage();
        process.exitCode = 1;
        return { output: null };
    }

    const rawEnv = normalizeRawEnv(env?.REPO_CONTEXT_KIT_BUDGET);
    const resolved = resolveBudgetMode([], env);
    const warning = rawEnv && rawEnv.toLowerCase() !== resolved
        ? `Invalid REPO_CONTEXT_KIT_BUDGET value: ${rawEnv} (expected off|auto|full). Falling back to off.`
        : null;

    const output = [
        "# Budget Policy",
        "",
        `- env: ${rawEnv ?? "-"}`,
        `- resolved: ${resolved}`,
        warning ? `- warning: ${warning}` : "- warning: -",
        "",
        "## Usage",
        "",
        "- Enable automatic policy (opt-in):",
        "  - repo-context-kit <command> --budget auto",
        "  - or set REPO_CONTEXT_KIT_BUDGET=auto",
        "- Full expansion:",
        "  - repo-context-kit <command> --budget full",
        "  - or set REPO_CONTEXT_KIT_BUDGET=full",
    ].join("\n");

    console.log(output.trimEnd());
    return { output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    runBudget(process.argv.slice(2)).catch((error) => {
        console.error("Unexpected error:", error);
        process.exitCode = 1;
    });
}

