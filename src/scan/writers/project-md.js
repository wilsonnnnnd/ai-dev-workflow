import {
    AUTO_GENERATED_END,
    AUTO_GENERATED_START,
} from "../constants.js";
import {
    ensureDir,
    exists,
    readText,
    writeText,
} from "../fs-utils.js";

export function updateProjectMd(newContent) {
    const relativePath = "ai/project.md";

    ensureDir("ai");

    if (!exists(relativePath)) {
        const initial = `# Project Context

${AUTO_GENERATED_START}
${newContent}
${AUTO_GENERATED_END}

## Manual Notes

- Reuse existing modules, components, and utilities before creating new structures or duplicate logic.
- Keep changes localized and avoid broad edits to shared or global surfaces unless they are clearly required.
- Preserve backward compatibility for shared code paths, public APIs, and common workflows where possible.
- Treat config, environment behavior, routing, and schema changes as higher-risk areas that need extra caution.
`;
        writeText(relativePath, initial);
        return;
    }

    const existing = readText(relativePath);
    const startIndex = existing.indexOf(AUTO_GENERATED_START);
    const endIndex = existing.indexOf(AUTO_GENERATED_END);

    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
        console.log("AUTO-GENERATED markers not found in ai/project.md.");
        console.log("Skipping update to avoid overwriting manual content.");
        return;
    }

    const before = existing.slice(0, startIndex + AUTO_GENERATED_START.length);
    const after = existing.slice(endIndex);
    const updated = `${before}
${newContent}
${after}`;

    writeText(relativePath, updated);
}
