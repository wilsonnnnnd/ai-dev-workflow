/**
 * Context Relevance Ranking
 * 
 * Score files and symbols based on:
 * - Import/dependency distance
 * - Shared features/modules
 * - Recent modification
 * - Shared symbols
 * - Type compatibility
 */

import { readJson } from "../scan/fs-utils.js";
import { CONTEXT_INDEX_FILES_PATH, CONTEXT_INDEX_SYMBOLS_PATH } from "../scan/constants.js";

const SCORE_WEIGHTS = {
    directImport: 100,
    sharedModule: 75,
    recentModification: 50,
    sharedSymbol: 60,
    dependencyDistance: 40,
};

function normalizePathForComparison(path1, path2) {
    const normalize = (p) => p.replace(/\\/g, "/").toLowerCase();
    return normalize(path1) === normalize(path2);
}

function calculateImportDistance(sourceFile, targetFile, allImports = {}) {
    if (normalizePathForComparison(sourceFile, targetFile)) {
        return 0;
    }

    const sourceDir = sourceFile.split("/").slice(0, -1).join("/");
    const targetDir = targetFile.split("/").slice(0, -1).join("/");

    if (sourceDir === targetDir) {
        return 1;
    }

    const sourceDepth = sourceDir.split("/").length;
    const targetDepth = targetDir.split("/").length;
    const depthDiff = Math.abs(sourceDepth - targetDepth);

    return Math.min(5, depthDiff);
}

function extractModuleFromPath(filePath) {
    const parts = filePath.split("/");
    if (parts.length > 2 && parts[0] !== ".") {
        return parts[0];
    }
    if (parts.length > 1 && parts[0] === "src") {
        return parts[1];
    }
    return null;
}

function scoreContextRelevance(sourceFile, targetFile, context = {}) {
    let score = 0;
    const reasons = [];

    // 1. Direct import/dependency
    const sourceImports = context.imports?.[sourceFile] || [];
    if (
        sourceImports.some(
            (imp) =>
                normalizePathForComparison(imp, targetFile) ||
                targetFile.includes(imp)
        )
    ) {
        score += SCORE_WEIGHTS.directImport;
        reasons.push("direct_import");
    }

    // 2. Shared module
    const sourceModule = extractModuleFromPath(sourceFile);
    const targetModule = extractModuleFromPath(targetFile);
    if (sourceModule && sourceModule === targetModule && sourceModule !== null) {
        score += SCORE_WEIGHTS.sharedModule;
        reasons.push("shared_module");
    }

    // 3. Recent modification (if available)
    if (context.recentFiles?.includes(targetFile)) {
        score += SCORE_WEIGHTS.recentModification;
        reasons.push("recently_modified");
    }

    // 4. Shared symbols
    if (context.symbols) {
        const sourceSymbols = context.symbols[sourceFile] || [];
        const targetSymbols = context.symbols[targetFile] || [];
        const sharedCount = sourceSymbols.filter((s) =>
            targetSymbols.some((t) => t.name === s.name)
        ).length;
        if (sharedCount > 0) {
            score += SCORE_WEIGHTS.sharedSymbol * Math.min(sharedCount, 3);
            reasons.push(`${sharedCount}_shared_symbols`);
        }
    }

    // 5. Dependency distance penalty
    const distance = calculateImportDistance(sourceFile, targetFile);
    score -= distance * 5;

    return {
        score: Math.max(0, Math.round(score)),
        reasons,
        distance,
    };
}

export function rankFilesForContext(sourceFile, allFiles = [], context = {}) {
    const ranked = allFiles
        .map((file) => ({
            file,
            ...scoreContextRelevance(sourceFile, file, context),
        }))
        .sort((a, b) => b.score - a.score);

    return ranked;
}

export function filterRelevantFiles(
    sourceFile,
    allFiles = [],
    context = {},
    maxCount = 10,
    minScore = 0
) {
    const ranked = rankFilesForContext(sourceFile, allFiles, context);
    const filtered = ranked
        .filter((item) => item.score >= minScore)
        .slice(0, maxCount);

    return filtered;
}

export function computeRelevanceScore(sourceFile, targetFile, context = {}) {
    return scoreContextRelevance(sourceFile, targetFile, context);
}

export function buildRelevanceContext(taskId = null) {
    const files = readJson(CONTEXT_INDEX_FILES_PATH) || [];
    const symbols = readJson(CONTEXT_INDEX_SYMBOLS_PATH) || [];

    const fileMap = {};
    const symbolMap = {};
    const recentFiles = [];

    for (const file of files) {
        fileMap[file.path] = file;
        if (file.modifiedAt) {
            const daysSince = Math.floor(
                (Date.now() - new Date(file.modifiedAt).getTime()) / (1000 * 60 * 60 * 24)
            );
            if (daysSince <= 7) {
                recentFiles.push(file.path);
            }
        }
    }

    for (const symbol of symbols) {
        if (!symbolMap[symbol.file]) {
            symbolMap[symbol.file] = [];
        }
        symbolMap[symbol.file].push(symbol);
    }

    return {
        files: fileMap,
        symbols: symbolMap,
        recentFiles,
        allFilePaths: files.map((f) => f.path),
    };
}
