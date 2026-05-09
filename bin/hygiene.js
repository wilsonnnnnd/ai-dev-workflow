#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { withRepoRoot } from "../src/runtime/root-context.js";
import { serializeJson } from "../src/runtime/serialize.js";
import { hygieneScan } from "../src/hygiene/scan.js";
import { hygienePlan } from "../src/hygiene/plan.js";
import { applyHygienePlan } from "../src/hygiene/apply.js";
import { getArgValue, getFlag, pickCommand, stripFlag } from "./_cli-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
    console.log(`Usage:
  repo-context-kit hygiene scan [--json]
  repo-context-kit hygiene plan [--json]
  repo-context-kit hygiene apply --from-plan <path|-> --confirm <token> --enable-write [--runtime-mode <SAFE|STANDARD|REVIEW|EXPERIMENTAL>] [--json]
`);
}

export async function runHygiene(args = []) {
    const json = getFlag(args, "--json");
    const filteredArgs = stripFlag(args, "--json");
    const sub = pickCommand(filteredArgs, null);
    if (!sub || sub === "help" || sub === "--help") {
        usage();
        return;
    }

    if (sub === "scan") {
        const result = withRepoRoot(process.cwd(), () => hygieneScan({ repoRoot: process.cwd() }));
        if (json) {
            console.log(serializeJson(result));
            return;
        }
        console.log("Hygiene Scan");
        console.log("");
        console.log(`- candidates: ${result.candidates.length}`);
        for (const item of result.candidates.slice(0, 60)) {
            console.log(`- ${item.type} (${item.category})`);
            console.log(`  reason: ${item.reason}`);
            if (item.suggestedAction) {
                console.log(`  suggested: ${item.suggestedAction}`);
            }
        }
        if (result.candidates.length > 60) {
            console.log(`- … (${result.candidates.length - 60} more)`);
        }
        return;
    }

    if (sub === "plan") {
        const scan = withRepoRoot(process.cwd(), () => hygieneScan({ repoRoot: process.cwd() }));
        const planned = withRepoRoot(process.cwd(), () => hygienePlan({ repoRoot: process.cwd(), scanResult: scan }));
        if (json) {
            console.log(serializeJson(planned));
            return;
        }
        console.log("Hygiene Plan");
        console.log("");
        console.log(`- pauseToken: ${planned.plan.pauseToken}`);
        console.log(`- digest: ${planned.plan.digest}`);
        console.log("");
        console.log("Summary:");
        console.log(`- archiveTasks: ${planned.plan.archiveTasks.length}`);
        console.log(`- archiveSnapshots: ${planned.plan.archiveSnapshots.length}`);
        console.log(`- quarantineArtifacts: ${planned.plan.quarantineArtifacts.length}`);
        console.log(`- detachInvalidReferences: ${planned.plan.detachInvalidReferences.length}`);
        console.log(`- noActionItems: ${planned.plan.noActionItems.length}`);
        return;
    }

    if (sub === "apply") {
        const enableWrite = getFlag(filteredArgs, "--enable-write");
        const fromPlan = getArgValue(filteredArgs, "--from-plan");
        const confirm = getArgValue(filteredArgs, "--confirm");
        const runtimeMode = getArgValue(filteredArgs, "--runtime-mode");
        if (!fromPlan || !confirm) {
            console.error("Missing required flags: --from-plan and --confirm");
            usage();
            process.exitCode = 1;
            return;
        }
        try {
            const applied = applyHygienePlan({
                repoRoot: process.cwd(),
                planSource: fromPlan,
                enableWrite,
                confirm,
                runtimeMode,
            });
            if (json) {
                console.log(serializeJson({ ok: true, summary: applied.summary, snapshotId: applied.snapshotId }));
                return;
            }
            console.log(applied.output.trimEnd());
        } catch (error) {
            const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
            if (json) {
                console.log(serializeJson({ ok: false, error: message, code: error?.code ?? null, details: error?.details ?? null }));
            } else {
                console.error(message);
            }
            process.exitCode = 1;
        }
        return;
    }

    console.error("Unknown hygiene command.");
    usage();
    process.exitCode = 1;
}
