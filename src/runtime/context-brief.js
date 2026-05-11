/**
 * Context Brief Mode - Token-efficient, compressed context format
 * 
 * Provides machine-readable, densely-packed project context
 * suitable for caching and reuse across multiple prompts.
 */

export function generateContextBrief(projectData) {
    return {
        // Compact header
        project: {
            name: projectData.name || "-",
            type: projectData.type || "generic",
        },
        
        // Canonicalized rule reference (not full text)
        rules: "See: .aidw/rules-canonical.md",
        
        // Machine-readable tech stack
        stack: {
            language: projectData.language || null,
            framework: projectData.framework || null,
            runtime: projectData.runtime || null,
        },
        
        // UI context only if present
        ...(projectData.hasUI ? {
            ui: {
                framework: projectData.uiFramework || null,
                styling: projectData.stylingSystems || [],
                components: projectData.componentLibraries || [],
            },
        } : {}),
        
        // Key directories (names only, no descriptions)
        dirs: {
            entry: projectData.entryPoints || [],
            ui: projectData.uiDirs || [],
            util: projectData.utilityDirs || [],
            test: projectData.testDirs || [],
        },
        
        // Risk summary (not verbose list)
        risk_summary: {
            count: projectData.riskCount || 0,
            level: projectData.riskLevel || "low",
        },
        
        // Important files (names only)
        key_files: projectData.keyFiles || [],
        
        // Canonical source references
        sources: {
            rules: ".aidw/rules-canonical.md",
            workflow: ".aidw/workflow.md",
            safety: ".aidw/safety.md",
            project: ".aidw/AI_project.md",
        },
    };
}

export function formatContextBriefCompact(brief) {
    const lines = [];
    
    // Project header
    if (brief.project) {
        lines.push(`# ${brief.project.name} (${brief.project.type})`);
    }
    
    // Tech stack
    if (brief.stack && Object.values(brief.stack).some(Boolean)) {
        const parts = Object.entries(brief.stack)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" | ");
        if (parts) lines.push(`Stack: ${parts}`);
    }
    
    // UI context if present
    if (brief.ui) {
        const ui_parts = [];
        if (brief.ui.framework) ui_parts.push(brief.ui.framework);
        if (brief.ui.styling?.length) ui_parts.push(`styling: ${brief.ui.styling.join(", ")}`);
        if (brief.ui.components?.length) ui_parts.push(`components: ${brief.ui.components.join(", ")}`);
        if (ui_parts.length) lines.push(`UI: ${ui_parts.join(" | ")}`);
    }
    
    // Key directories
    if (brief.dirs) {
        const dir_lines = [];
        if (brief.dirs.entry?.length) dir_lines.push(`Entry: ${brief.dirs.entry.join(", ")}`);
        if (brief.dirs.ui?.length) dir_lines.push(`UI: ${brief.dirs.ui.join(", ")}`);
        if (brief.dirs.util?.length) dir_lines.push(`Utils: ${brief.dirs.util.join(", ")}`);
        lines.push(...dir_lines);
    }
    
    // Risks summary
    if (brief.risk_summary) {
        lines.push(`Risks: ${brief.risk_summary.count} (${brief.risk_summary.level})`);
    }
    
    // Source references
    lines.push(""); // Blank line
    lines.push("References:");
    lines.push(`- Rules: See .aidw/rules-canonical.md`);
    lines.push(`- Workflow: See .aidw/workflow.md`);
    if (brief.project.type === "web-app" || brief.ui) {
        lines.push(`- UI Design: See .aidw/AI_project.md#UI Design Context`);
    }
    
    return lines.join("\n");
}

export function buildContextReference(data) {
    /**
     * Machine-readable context reference
     * Suitable for:
     * - Caching and reuse
     * - Hash computation
     * - Relevance scoring
     * - Deduplication detection
     */
    return {
        version: "1",
        hash_fields: {
            rules: ".aidw/rules-canonical.md",
            workflow: ".aidw/workflow.md",
            project_type: data.type,
            framework: data.framework,
        },
        cache_ttl: 3600, // 1 hour
        volatile: false,
    };
}
