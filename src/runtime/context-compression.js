import { createHash } from "node:crypto";

/**
 * Context Compression & Token Economy Utilities
 * 
 * Supports:
 * - Context hashing for caching
 * - Cacheability scoring
 * - Relevance ranking
 * - Semantic deduplication detection
 * - Progressive escalation
 */

export function computeContextHash(context) {
    if (!context) return null;
    
    const normalized = typeof context === "string" 
        ? context 
        : JSON.stringify(context, Object.keys(context).sort());
    
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function scoreContextCacheability(context, isStableConfig = false) {
    if (!context) return 0;
    
    let score = 100;
    
    // Reduce score if context changes frequently
    if (context.includes("timestamp") || context.includes("recent")) score -= 10;
    if (context.includes("volatile")) score -= 20;
    
    // Increase score if context is stable
    if (isStableConfig) score += 20;
    
    return Math.max(0, Math.min(100, score));
}

export function detectSemanticDuplication(rules) {
    if (!Array.isArray(rules) || rules.length === 0) {
        return { duplicates: [], density: 0 };
    }
    
    const duplicates = [];
    const seen = new Map();
    
    for (const rule of rules) {
        const normalized = normalizeRuleText(rule);
        
        if (seen.has(normalized)) {
            duplicates.push({
                original: seen.get(normalized),
                duplicate: rule,
                similarity: 1.0,
            });
        } else {
            seen.set(normalized, rule);
        }
    }
    
    const density = duplicates.length > 0 ? duplicates.length / rules.length : 0;
    
    return { duplicates, density };
}

export function normalizeRuleText(text) {
    if (!text) return "";
    
    return text
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9\s]/g, "")
        .trim();
}

export function buildEscalationDecision(riskScore, testStatus, hasRecentFailure) {
    const shouldEscalate = 
        riskScore > 50 || 
        testStatus === "failing" || 
        hasRecentFailure;
    
    const reasons = [];
    if (riskScore > 50) reasons.push("high_risk");
    if (testStatus === "failing") reasons.push("test_failure");
    if (hasRecentFailure) reasons.push("recent_failure");
    
    return {
        escalate: shouldEscalate,
        level: shouldEscalate ? "verbose" : "compact",
        reason_codes: reasons,
        context_hash_required: !shouldEscalate,
    };
}

export function buildContextCompressionMetrics(context) {
    return {
        context_hash: computeContextHash(context),
        cacheability: scoreContextCacheability(context),
        token_estimate: Math.ceil(context.length / 4), // Rough estimate
        compression_ratio: 1.0,
        escalation_score: 0,
    };
}
