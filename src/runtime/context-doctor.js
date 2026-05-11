/**
 * Context Doctor - Analyze and diagnose context health
 * 
 * Compact, deterministic context analysis for:
 * - Duplication detection
 * - Prose density
 * - Cache potential
 * - Signal/noise ratio
 * - Canonicalization recommendations
 */

import fs from "node:fs";
import path from "node:path";
import { exists, readText } from "../scan/fs-utils.js";

const CANONICAL_RULES = [
    "Reuse first",
    "Logic first",
    "Do not break",
    "Keep scope tight",
    "Avoid unrelated",
];

const KEY_WORKFLOW_PHRASES = [
    "Read AGENTS.md",
    "Read PROJECT.md",
    "Read .aidw/AI_project.md",
    "Implementation order",
];

const UI_GUIDANCE_PHRASES = [
    "UI design system",
    "reuse existing UI",
    "reuse existing components",
    "design tokens",
    "layout conventions",
];

function analyzeFileForDuplication(filePath) {
    if (!exists(filePath)) {
        return { duplicates: 0, sections: [] };
    }

    const content = readText(filePath);
    const sections = content.split(/\n#+\s+/);
    const duplicateCounts = new Map();

    for (const section of sections) {
        const lines = section.split("\n");
        for (const line of lines) {
            const normalized = line
                .toLowerCase()
                .replace(/\s+/g, " ")
                .replace(/[^a-z0-9\s]/g, "")
                .trim();

            if (normalized.length > 10) {
                duplicateCounts.set(normalized, (duplicateCounts.get(normalized) || 0) + 1);
            }
        }
    }

    const duplicates = Array.from(duplicateCounts.values()).filter((count) => count > 1).length;

    return {
        duplicates,
        sections: sections.length,
        uniqueLines: duplicateCounts.size,
    };
}

function countCanonicalReferenceDuplicates(content) {
    let duplicates = 0;

    for (const rule of CANONICAL_RULES) {
        const pattern = new RegExp(rule, "gi");
        const matches = content.match(pattern) || [];
        if (matches.length > 1) {
            duplicates += matches.length - 1;
        }
    }

    return duplicates;
}

function calculateProseDensity(content) {
    const lines = content.split("\n");
    const proseLines = lines.filter(
        (line) => line.trim().length > 50 && !line.trim().startsWith("-") && !line.trim().startsWith("#"),
    );
    return proseLines.length > 0 ? proseLines.length / lines.length : 0;
}

function calculateSignalNoiseRatio(content) {
    const hasStructure = /^[#\-\*\[]/.test(content);
    const hasComfortText =
        /please|remember|try|carefully|should|make sure|ensure/i.test(content);

    if (hasStructure && !hasComfortText) {
        return 0.95;
    }
    if (hasStructure && hasComfortText) {
        return 0.75;
    }
    if (!hasStructure && !hasComfortText) {
        return 0.8;
    }
    return 0.5;
}

function findDuplicatedSections(content, keyword) {
    const lines = content.split("\n");
    const occurrences = [];

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(keyword.toLowerCase())) {
            occurrences.push(i);
        }
    }

    return occurrences.length > 1 ? { keyword, count: occurrences.length } : null;
}

export function analyzeContextHealth(repoRoot = ".") {
    const agentsFile = path.join(repoRoot, "AGENTS.md");
    const rulesFile = path.join(repoRoot, ".aidw", "rules.md");
    const canonicalFile = path.join(repoRoot, ".aidw", "rules-canonical.md");
    const workflowFile = path.join(repoRoot, ".aidw", "workflow.md");
    const projectFile = path.join(repoRoot, ".aidw", "AI_project.md");

    const files = {
        agents: readText(agentsFile) || "",
        rules: readText(rulesFile) || "",
        canonical: readText(canonicalFile) || "",
        workflow: readText(workflowFile) || "",
        project: readText(projectFile) || "",
    };

    const allContent = Object.values(files).join("\n");

    // Duplication analysis
    const ruleDuplicates = countCanonicalReferenceDuplicates(allContent);
    const workflowDuplicates = findDuplicatedSections(allContent, "implementation order") ? 1 : 0;
    const uiGuidanceDuplicates = findDuplicatedSections(allContent, "UI design system") ? 1 : 0;

    const totalDuplicates = ruleDuplicates + workflowDuplicates + uiGuidanceDuplicates;

    // Prose density
    const totalLines = allContent.split("\n").length;
    const proseDensity = calculateProseDensity(allContent);
    const signalNoiseRatio = calculateSignalNoiseRatio(allContent);

    // Cacheability
    const canonicalRatio = files.canonical.length / allContent.length;
    const referenceRatio =
        (allContent.match(/See:/g) || []).length / allContent.split("\n").length;

    // Recommendations
    const recommendations = [];

    if (ruleDuplicates > 0) {
        recommendations.push("canonicalize_rules");
    }
    if (proseDensity > 0.4) {
        recommendations.push("reduce_prose");
    }
    if (referenceRatio < 0.05) {
        recommendations.push("add_references");
    }
    if (signalNoiseRatio < 0.7) {
        recommendations.push("remove_comfort_text");
    }

    return {
        health: {
            duplication_score: Math.max(0, 1 - totalDuplicates / 20), // 0-1, higher is better
            prose_density: Math.round(proseDensity * 100) / 100,
            cacheable_context_ratio: Math.round(canonicalRatio * 100) / 100,
            signal_noise_ratio: Math.round(signalNoiseRatio * 100) / 100,
            reference_density: Math.round(referenceRatio * 100) / 100,
        },
        duplication: {
            duplicated_rules: ruleDuplicates,
            duplicated_workflow_sections: workflowDuplicates,
            repeated_ui_guidance: uiGuidanceDuplicates,
            total_duplicates: totalDuplicates,
        },
        canonicalization: {
            canonical_coverage: canonicalFile ? (exists(canonicalFile) ? "present" : "missing") : "n/a",
            references_found: (allContent.match(/See:/g) || []).length,
            expected_references: 6,
        },
        recommendations: recommendations.length > 0 ? recommendations : ["healthy"],
        files_analyzed: {
            agents: !!files.agents,
            rules: !!files.rules,
            canonical: !!files.canonical,
            workflow: !!files.workflow,
        },
    };
}

export function formatContextDoctorCompact(analysis) {
    const lines = [];

    lines.push("# Context Health");
    lines.push(`duplication_score: ${analysis.health.duplication_score}`);
    lines.push(`signal_noise_ratio: ${analysis.health.signal_noise_ratio}`);
    lines.push(`prose_density: ${analysis.health.prose_density}`);
    lines.push(`cacheable_ratio: ${analysis.health.cacheable_context_ratio}`);

    lines.push("");
    lines.push("# Duplication");
    lines.push(`duplicated_rules: ${analysis.duplication.duplicated_rules}`);
    lines.push(`workflow_dupes: ${analysis.duplication.duplicated_workflow_sections}`);
    lines.push(`ui_guidance_dupes: ${analysis.duplication.repeated_ui_guidance}`);

    lines.push("");
    lines.push("# Recommendations");
    for (const rec of analysis.recommendations) {
        lines.push(`- ${rec}`);
    }

    return lines.join("\n");
}

export function formatContextDoctorJson(analysis) {
    return JSON.stringify(analysis, null, 2);
}
