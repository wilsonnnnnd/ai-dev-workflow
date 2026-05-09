import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { serializeJson } from "../runtime/serialize.js";
import { HYGIENE_LIMITS, HYGIENE_PATHS, HYGIENE_VERSION } from "./constants.js";

function sha256Hex(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function buildPlanDigest(plan) {
    const normalized = serializeJson(plan, { indent: 0 }).trim();
    return sha256Hex(normalized);
}

function buildPauseToken(digest) {
    return sha256Hex(`${HYGIENE_VERSION}:${String(digest ?? "")}`).slice(0, 32);
}

function uniqSorted(values) {
    return [...new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function ensureDir(fullPath) {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
}

function toRel(repoRoot, fullPath) {
    return path.relative(repoRoot, fullPath).replaceAll("\\", "/");
}

function safeRelPath(value) {
    const text = String(value ?? "").trim().replaceAll("\\", "/");
    if (!text) return null;
    if (text.startsWith("/") || /^[A-Za-z]:\//.test(text)) return null;
    if (text.split("/").some((p) => p === ".." || p === "." || !p)) return null;
    return text;
}

function isTaskFilePath(rel) {
    const p = safeRelPath(rel);
    return Boolean(p && p.startsWith("task/") && p.toLowerCase().endsWith(".md"));
}

function isRuntimeManagedPath(rel) {
    const p = safeRelPath(rel);
    if (!p) return false;
    if (p.startsWith(".aidw/")) return true;
    if (p.startsWith("task/")) return true;
    return false;
}

export function hygienePlan({ scanResult, repoRoot = process.cwd() } = {}) {
    const root = String(repoRoot ?? "").trim() || process.cwd();
    const candidates = Array.isArray(scanResult?.candidates) ? scanResult.candidates : [];

    const archiveTasks = [];
    const detachInvalidReferences = [];
    const quarantineArtifacts = [];
    const archiveSnapshots = [];
    const noActionItems = [];
    const risks = [];

    const nowIso = null;
    for (const item of candidates) {
        const type = String(item?.type ?? "").trim();
        const evidence = item?.evidence && typeof item.evidence === "object" ? item.evidence : {};
        if (type === "completed-old-task") {
            const from = safeRelPath(evidence.file);
            const taskId = String(evidence.taskId ?? "").trim().toUpperCase();
            if (!from || !isTaskFilePath(from) || !taskId) continue;
            const to = `${HYGIENE_PATHS.archiveTasksDir}/${taskId}/${path.basename(from)}`;
            archiveTasks.push({ taskId, from, to, reason: "completed-old-task" });
            continue;
        }
        if (type === "orphan-task-file") {
            const from = safeRelPath(evidence.file);
            if (!from || !isTaskFilePath(from)) continue;
            const inferred = String(evidence.taskId ?? "").trim().toUpperCase() || "ORPHAN";
            const to = `${HYGIENE_PATHS.archiveTasksDir}/${inferred}/${path.basename(from)}`;
            archiveTasks.push({ taskId: inferred, from, to, reason: "orphan-task-file" });
            continue;
        }
        if (type === "detached-registry-entry") {
            const taskId = String(evidence.taskId ?? "").trim().toUpperCase();
            const file = safeRelPath(evidence.file);
            if (!taskId) continue;
            detachInvalidReferences.push({ taskId, file: file || null, action: "detach", reason: "missing-task-file" });
            continue;
        }
        if (type === "unused-snapshot") {
            const from = HYGIENE_PATHS.snapshotsFile;
            if (!isRuntimeManagedPath(from)) continue;
            const to = `${HYGIENE_PATHS.archiveSnapshotsDir}/snapshots.rotated.jsonl`;
            archiveSnapshots.push({
                action: "rotate",
                from,
                to,
                retainLines: HYGIENE_LIMITS.snapshotRetainLines,
                maxBytes: HYGIENE_LIMITS.snapshotRotateMaxBytes,
                reason: "unused-snapshot",
            });
            continue;
        }
        if (type === "orphan-runtime-artifact") {
            const from = safeRelPath(evidence.path);
            if (!from || !isRuntimeManagedPath(from)) continue;
            const to = `${HYGIENE_PATHS.quarantineDir}/runtime/${path.basename(from)}`;
            quarantineArtifacts.push({ from, to, reason: "orphan-runtime-artifact" });
            continue;
        }
        noActionItems.push({
            type,
            reason: String(item?.reason ?? "").trim() || "No action",
            evidence,
            suggestedAction: String(item?.suggestedAction ?? "").trim() || null,
        });
    }

    const base = {
        hygieneVersion: HYGIENE_VERSION,
        repoRoot: root,
        generatedAt: nowIso,
        archiveTasks: archiveTasks
            .filter((x) => isRuntimeManagedPath(x.from) && isRuntimeManagedPath(x.to))
            .sort((a, b) => (a.taskId || "").localeCompare(b.taskId || "") || a.from.localeCompare(b.from)),
        archiveSnapshots: archiveSnapshots
            .slice(0, 1)
            .sort((a, b) => String(a.from).localeCompare(String(b.from))),
        quarantineArtifacts: quarantineArtifacts
            .filter((x) => isRuntimeManagedPath(x.from) && isRuntimeManagedPath(x.to))
            .sort((a, b) => a.from.localeCompare(b.from)),
        detachInvalidReferences: detachInvalidReferences
            .sort((a, b) => a.taskId.localeCompare(b.taskId)),
        noActionItems: noActionItems.slice(0, 40),
        risks: uniqSorted(risks),
    };

    delete base.generatedAt;
    const digest = buildPlanDigest(base);
    const pauseToken = buildPauseToken(digest);

    const plan = {
        ...base,
        digest,
        pauseToken,
    };

    const suggestedActions = [];
    if (plan.archiveTasks.length > 0) suggestedActions.push("Review and apply the task archive plan (archive only; no delete).");
    if (plan.quarantineArtifacts.length > 0) suggestedActions.push("Quarantine stale runtime state artifacts if they are safe to remove.");
    if (plan.archiveSnapshots.length > 0) suggestedActions.push("Rotate snapshots (archive old snapshots.jsonl and retain a bounded tail).");
    if (plan.detachInvalidReferences.length > 0) suggestedActions.push("Detach invalid task registry references (or restore missing files).");

    return {
        ok: true,
        plan,
        summary: {
            archiveTasks: plan.archiveTasks.length,
            archiveSnapshots: plan.archiveSnapshots.length,
            quarantineArtifacts: plan.quarantineArtifacts.length,
            detachInvalidReferences: plan.detachInvalidReferences.length,
            noActionItems: plan.noActionItems.length,
            suggestedActions,
        },
    };
}

export function writeHygienePlanFile({ repoRoot, plan, outPath } = {}) {
    const root = String(repoRoot ?? "").trim() || process.cwd();
    const rel = String(outPath ?? "").trim();
    const filePath = rel && rel !== "-" ? path.resolve(root, rel) : null;
    const content = serializeJson({ plan }, { indent: 4 });
    if (!filePath) {
        process.stdout.write(content);
        return { ok: true, file: "-" };
    }
    ensureDir(filePath);
    fs.writeFileSync(filePath, content, "utf-8");
    return { ok: true, file: toRel(root, filePath) };
}
