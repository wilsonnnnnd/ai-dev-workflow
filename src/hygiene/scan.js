import fs from "node:fs";
import path from "node:path";
import { listSnapshots } from "../runtime/snapshot-reader.js";
import { withRepoRoot } from "../runtime/root-context.js";
import { parseTaskRegistry } from "../scan/task-registry.js";
import { getTaskFileMetadata } from "../scan/task-files.js";
import { HYGIENE_LIMITS, HYGIENE_PATHS } from "./constants.js";

function uniqSorted(values) {
    return [...new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function toRel(repoRoot, fullPath) {
    return path.relative(repoRoot, fullPath).replaceAll("\\", "/");
}

function statSafe(fullPath) {
    try {
        return fs.statSync(fullPath);
    } catch {
        return null;
    }
}

function isOlderThanDays(stat, days) {
    if (!stat) return false;
    const ms = Number(stat.mtimeMs);
    if (!Number.isFinite(ms)) return false;
    const ageMs = days * 24 * 60 * 60 * 1000;
    return Date.now() - ms > ageMs;
}

function clampCandidates(list, { maxPerType, maxTotal }) {
    const out = [];
    const counts = new Map();
    for (const item of list) {
        const type = String(item?.type ?? "").trim();
        if (!type) continue;
        const current = counts.get(type) ?? 0;
        if (current >= maxPerType) continue;
        counts.set(type, current + 1);
        out.push(item);
        if (out.length >= maxTotal) break;
    }
    return out;
}

export function hygieneScan({ repoRoot = process.cwd() } = {}) {
    const root = String(repoRoot ?? "").trim() || process.cwd();
    const candidates = [];

    const registry = withRepoRoot(root, () => parseTaskRegistry());
    const tasks = Array.isArray(registry.tasks) ? registry.tasks : [];
    const taskIds = new Set(tasks.map((t) => String(t?.id ?? "").trim().toUpperCase()).filter(Boolean));
    const taskFiles = withRepoRoot(root, () => getTaskFileMetadata());
    const fileTasksByPath = new Map(taskFiles.map((t) => [String(t.path ?? "").trim(), t]));
    const registryFiles = new Set(tasks.map((t) => String(t?.file ?? "").trim()).filter(Boolean));

    for (const task of tasks) {
        const id = String(task?.id ?? "").trim().toUpperCase();
        const status = String(task?.status ?? "").trim().toLowerCase();
        const file = String(task?.file ?? "").trim();
        if (!id) continue;

        if (file && !fs.existsSync(path.resolve(root, file))) {
            candidates.push({
                type: "detached-registry-entry",
                category: "task",
                riskLevel: "warning",
                reason: "Task registry references a missing task file.",
                evidence: { taskId: id, file },
                suggestedAction: "Detach the invalid registry entry (or restore the missing file).",
            });
        }

        const parsed = file ? fileTasksByPath.get(file) : null;
        const missingSections = [];
        if (parsed) {
            if (!parsed.hasAcceptanceCriteria) missingSections.push("Acceptance Criteria");
            if (!parsed.hasTestCommand) missingSections.push("Test Command");
            if (!parsed.hasDefinitionOfDone) missingSections.push("Definition of Done");
        }
        if ((status === "todo" || status === "in_progress") && missingSections.length > 0) {
            candidates.push({
                type: "stale-task",
                category: "task",
                riskLevel: "info",
                reason: "Active task is missing required verification sections.",
                evidence: { taskId: id, missingSections },
                suggestedAction: "Fill missing sections to keep execution verifiable and bounded.",
            });
        }
        if (status === "done" && file) {
            const stat = statSafe(path.resolve(root, file));
            if (isOlderThanDays(stat, HYGIENE_LIMITS.completedTaskArchiveAgeDays)) {
                candidates.push({
                    type: "completed-old-task",
                    category: "task",
                    riskLevel: "info",
                    reason: "Completed task is old and can be archived to reduce clutter.",
                    evidence: { taskId: id, file, mtimeMs: stat?.mtimeMs ?? null, ageDays: HYGIENE_LIMITS.completedTaskArchiveAgeDays },
                    suggestedAction: "Archive the completed task file into .aidw/archive/tasks/ and detach it from the registry.",
                });
            }
        }
    }

    for (const task of taskFiles) {
        const filePath = String(task?.path ?? "").trim();
        const id = String(task?.id ?? "").trim().toUpperCase();
        if (!filePath) continue;
        const known = registryFiles.has(filePath) || (id && taskIds.has(id));
        if (!known) {
            candidates.push({
                type: "orphan-task-file",
                category: "task",
                riskLevel: "warning",
                reason: "Task file exists but is not referenced by task/task.md.",
                evidence: { file: filePath, taskId: id || null },
                suggestedAction: "Archive or quarantine the orphan task file (or add it to the registry).",
            });
        }
    }

    const snapshotsPath = path.resolve(root, HYGIENE_PATHS.snapshotsFile);
    if (fs.existsSync(snapshotsPath)) {
        const recent = listSnapshots({ repoRoot: root, limit: 200 });
        for (const snap of recent) {
            const taskId = snap?.taskId ? String(snap.taskId).trim().toUpperCase() : null;
            if (!taskId) {
                candidates.push({
                    type: "unused-snapshot",
                    category: "runtime",
                    riskLevel: "info",
                    reason: "Snapshot has no taskId and may be unused for long-term audit.",
                    evidence: { snapshotId: snap?.snapshotId ?? null, mode: snap?.mode ?? null },
                    suggestedAction: "Consider rotating snapshots and archiving older entries.",
                });
                continue;
            }
            if (taskId !== "VIRTUAL" && !taskIds.has(taskId)) {
                candidates.push({
                    type: "unused-snapshot",
                    category: "runtime",
                    riskLevel: "info",
                    reason: "Snapshot references a taskId that is not in the current registry.",
                    evidence: { snapshotId: snap?.snapshotId ?? null, taskId },
                    suggestedAction: "Rotate snapshots and archive older entries for audit hygiene.",
                });
            }
        }
    }

    const runtimeArtifacts = [
        HYGIENE_PATHS.executorStateFile,
        HYGIENE_PATHS.gateStateFile,
    ];
    for (const rel of runtimeArtifacts) {
        const full = path.resolve(root, rel);
        const stat = statSafe(full);
        if (!stat) continue;
        if (isOlderThanDays(stat, HYGIENE_LIMITS.staleRuntimeArtifactAgeDays)) {
            candidates.push({
                type: "orphan-runtime-artifact",
                category: "runtime",
                riskLevel: "info",
                reason: "Runtime state artifact is old and may be quarantined to reduce clutter.",
                evidence: { path: rel, mtimeMs: stat.mtimeMs ?? null, ageDays: HYGIENE_LIMITS.staleRuntimeArtifactAgeDays },
                suggestedAction: "Quarantine old runtime state artifacts (they will be recreated when needed).",
            });
        }
    }

    const bounded = clampCandidates(
        candidates.map((c) => ({
            ...c,
            id: `${c.type}:${c.category}:${JSON.stringify(c.evidence ?? {})}`.slice(0, 240),
        })),
        { maxPerType: HYGIENE_LIMITS.maxCandidatesPerType, maxTotal: HYGIENE_LIMITS.maxCandidatesTotal },
    );

    return {
        ok: true,
        repoRoot: root,
        candidates: bounded,
        summary: {
            total: bounded.length,
            types: uniqSorted(bounded.map((c) => c.type)),
        },
    };
}
