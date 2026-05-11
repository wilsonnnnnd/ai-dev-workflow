/**
 * Stable Cache Foundation
 * 
 * Hash stable context (architecture, rules, workflow, design system)
 * Enable future runtime to reference by hash instead of full text
 * 
 * Cache Strategy:
 * - Low volatility: Rules, workflow, design system (changes rarely)
 * - Medium volatility: Architecture, dependencies (changes occasionally) 
 * - High volatility: Project state, recent changes (changes frequently)
 */

import crypto from "node:crypto";
import { readText, exists } from "../scan/fs-utils.js";
import path from "node:path";

const CACHE_TTL_MS = {
    low: 7 * 24 * 60 * 60 * 1000, // 7 days
    medium: 24 * 60 * 60 * 1000, // 24 hours
    high: 60 * 60 * 1000, // 1 hour
};

function computeHash(content) {
    return crypto
        .createHash("sha256")
        .update(content)
        .digest("hex")
        .substring(0, 16);
}

function classifyVolatility(filePath) {
    const normalized = filePath.replace(/\\/g, "/").toLowerCase();

    // Low volatility
    if (
        normalized.includes("rules-canonical") ||
        normalized.includes("workflow.md") ||
        normalized.includes("design-system")
    ) {
        return "low";
    }

    // Medium volatility
    if (
        normalized.includes("project.md") ||
        normalized.includes("package.json") ||
        normalized.includes("architecture")
    ) {
        return "medium";
    }

    // High volatility (default)
    return "high";
}

export function computeContextHash(content) {
    return computeHash(content);
}

export function buildContextReference(content, filePath = "unknown") {
    const hash = computeHash(content);
    const volatility = classifyVolatility(filePath);
    const ttl = CACHE_TTL_MS[volatility];
    const expiresAt = new Date(Date.now() + ttl).toISOString();

    return {
        hash,
        volatility,
        expiresAt,
        ttl: ttl / 1000,
        size: content.length,
    };
}

export function scoreContextCacheability(content, isStableConfig = false) {
    let score = 50; // Base score

    // Prefer structured content
    if (content.includes("##")) score += 10;
    if (content.includes("###")) score += 5;

    // Prefer minimal prose
    const lines = content.split("\n");
    const proseLines = lines.filter((l) => l.trim().length > 60).length;
    const proseDensity = proseLines / lines.length;
    if (proseDensity < 0.2) score += 15;
    if (proseDensity > 0.5) score -= 20;

    // Prefer references over duplication
    if (content.includes("See:")) score += 10;
    if (content.includes("canonical")) score += 5;

    // Known stable patterns
    if (content.includes("rules") || content.includes("workflow")) score += 10;
    if (isStableConfig) score += 20;

    return Math.min(100, Math.max(0, score));
}

export function buildStableCacheIndex(repoRoot = ".") {
    const files = [
        { path: ".aidw/rules-canonical.md", isStable: true },
        { path: ".aidw/workflow.md", isStable: true },
        { path: "AGENTS.md", isStable: true },
        { path: "PROJECT.md", isStable: false },
        { path: "package.json", isStable: false },
    ];

    const index = [];

    for (const { path: filePath, isStable } of files) {
        const fullPath = path.join(repoRoot, filePath);
        if (exists(fullPath)) {
            const content = readText(fullPath);
            const ref = buildContextReference(content, filePath);
            const cacheability = scoreContextCacheability(content, isStable);

            index.push({
                file: filePath,
                ...ref,
                cacheability,
                cacheable: cacheability > 60,
            });
        }
    }

    return {
        generatedAt: new Date().toISOString(),
        files: index,
        totalCacheable: index.filter((f) => f.cacheable).length,
        summary: {
            low_volatility: index.filter((f) => f.volatility === "low").length,
            medium_volatility: index.filter((f) => f.volatility === "medium").length,
            high_volatility: index.filter((f) => f.volatility === "high").length,
        },
    };
}

export function formatCacheIndexCompact(index) {
    const lines = [];

    lines.push("# Stable Cache Index");
    lines.push(`Generated: ${index.generatedAt}`);
    lines.push("");

    lines.push("## Summary");
    lines.push(`- Total files: ${index.files.length}`);
    lines.push(`- Cacheable: ${index.totalCacheable}`);
    lines.push("");

    lines.push("## Files");
    for (const file of index.files) {
        const cached = file.cacheable ? "✓" : "✗";
        lines.push(`${cached} ${file.file} (${file.hash} [${file.volatility}])`);
    }

    return lines.join("\n");
}

export function validateCacheReference(ref) {
    return (
        ref &&
        typeof ref.hash === "string" &&
        ["low", "medium", "high"].includes(ref.volatility) &&
        typeof ref.expiresAt === "string"
    );
}

export function isCacheExpired(ref) {
    if (!validateCacheReference(ref)) return true;
    return new Date() > new Date(ref.expiresAt);
}
