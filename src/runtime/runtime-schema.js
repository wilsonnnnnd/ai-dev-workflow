const RUNTIME_JSON_SCHEMA_VERSION = "runtime/v1";
const RUNTIME_ENVELOPE_KINDS = new Set(["task", "context", "execution", "verification"]);
const LEGACY_RUNTIME_CONTRACT_FIELDS = [
    "runtimeVersion",
    "repoRoot",
    "workset",
    "prompt",
    "risks",
    "nextActions",
    "executionState",
    "planningSource",
    "scan",
    "task",
];

const BOUNDS = Object.freeze({
    maxTasks: 50,
    maxTaskDependencies: 64,
    maxTaskFacts: 16,
    maxTaskBoundaries: 12,
    maxTechStack: 20,
    maxRiskAreas: 30,
    maxEntrypoints: 40,
    maxTopFiles: 80,
    maxFileGroups: 40,
    maxWarnings: 30,
    maxRequiredChecks: 8,
    maxCapabilityTiers: 4,
});

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function isJsonSafePrimitive(value) {
    if (value == null) return true;
    if (typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    return false;
}

function describePath(pathParts) {
    return pathParts.length ? pathParts.join(".") : "(root)";
}

function scanJsonSafety(value, pathParts, errors, depth = 0) {
    if (depth > 60) {
        errors.push(`${describePath(pathParts)}: too deep`);
        return;
    }
    if (value === undefined) {
        errors.push(`${describePath(pathParts)}: undefined is not allowed`);
        return;
    }
    const type = typeof value;
    if (type === "function" || type === "symbol" || type === "bigint") {
        errors.push(`${describePath(pathParts)}: ${type} is not JSON-safe`);
        return;
    }
    if (isJsonSafePrimitive(value)) {
        return;
    }
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
            scanJsonSafety(value[i], [...pathParts, String(i)], errors, depth + 1);
        }
        return;
    }
    if (isPlainObject(value)) {
        const keys = Object.keys(value);
        for (const key of keys) {
            scanJsonSafety(value[key], [...pathParts, key], errors, depth + 1);
        }
        return;
    }
    errors.push(`${describePath(pathParts)}: unsupported object type`);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function validateArrayBound(path, value, maxItems, errors) {
    if (!Array.isArray(value)) {
        errors.push(`${path}: must be an array`);
        return;
    }
    if (value.length > maxItems) {
        errors.push(`${path}: exceeds maximum length ${maxItems}`);
    }
}

function validateStringArray(path, value, maxItems, errors, { allowNull = false } = {}) {
    validateArrayBound(path, value, maxItems, errors);
    if (!Array.isArray(value)) {
        return;
    }
    for (let i = 0; i < value.length; i += 1) {
        const item = value[i];
        if (allowNull && item === null) {
            continue;
        }
        if (typeof item !== "string") {
            errors.push(`${path}.${i}: must be a string${allowNull ? " or null" : ""}`);
        }
    }
}

function validateTaskPayload(payload, errors) {
    if (!isNonEmptyString(payload.registryPath)) {
        errors.push("payload.registryPath: must be a non-empty string");
    }

    validateArrayBound("payload.tasks", payload.tasks, BOUNDS.maxTasks, errors);
    if (!Array.isArray(payload.tasks)) {
        return;
    }

    for (let i = 0; i < payload.tasks.length; i += 1) {
        const task = payload.tasks[i];
        const base = `payload.tasks.${i}`;
        if (!isPlainObject(task)) {
            errors.push(`${base}: must be an object`);
            continue;
        }

        if (!isNonEmptyString(task.id)) errors.push(`${base}.id: must be a non-empty string`);
        if (!isNonEmptyString(task.title)) errors.push(`${base}.title: must be a non-empty string`);
        if (!isNonEmptyString(task.status)) errors.push(`${base}.status: must be a non-empty string`);
        if (!isNonEmptyString(task.priority)) errors.push(`${base}.priority: must be a non-empty string`);
        if (!isNonEmptyString(task.owner)) errors.push(`${base}.owner: must be a non-empty string`);

        validateStringArray(`${base}.dependencies`, task.dependencies, BOUNDS.maxTaskDependencies, errors);
        if (!(typeof task.file === "string" || task.file === null)) {
            errors.push(`${base}.file: must be a string or null`);
        }

        if (typeof task.hasAcceptanceCriteria !== "boolean") {
            errors.push(`${base}.hasAcceptanceCriteria: must be a boolean`);
        }
        if (typeof task.hasDefinitionOfDone !== "boolean") {
            errors.push(`${base}.hasDefinitionOfDone: must be a boolean`);
        }
        if (typeof task.hasTestCommand !== "boolean") {
            errors.push(`${base}.hasTestCommand: must be a boolean`);
        }

        if (!isPlainObject(task.facts)) {
            errors.push(`${base}.facts: must be an object`);
            continue;
        }

        if (!(typeof task.facts.goal === "string" || task.facts.goal === null)) {
            errors.push(`${base}.facts.goal: must be a string or null`);
        }
        validateStringArray(`${base}.facts.scope`, task.facts.scope, BOUNDS.maxTaskFacts, errors);
        validateStringArray(`${base}.facts.requirements`, task.facts.requirements, BOUNDS.maxTaskFacts, errors);
        validateStringArray(`${base}.facts.acceptanceCriteria`, task.facts.acceptanceCriteria, BOUNDS.maxTaskFacts, errors);
        validateStringArray(`${base}.facts.definitionOfDone`, task.facts.definitionOfDone, BOUNDS.maxTaskFacts, errors);
        validateStringArray(`${base}.facts.hardBoundaries`, task.facts.hardBoundaries, BOUNDS.maxTaskBoundaries, errors);
        validateStringArray(`${base}.facts.confirmationPoints`, task.facts.confirmationPoints, BOUNDS.maxTaskBoundaries, errors);
        if (!(typeof task.facts.testCommand === "string" || task.facts.testCommand === null)) {
            errors.push(`${base}.facts.testCommand: must be a string or null`);
        }
    }
}

function validateContextPayload(payload, errors) {
    if (!(typeof payload.projectType === "string" || payload.projectType === null)) {
        errors.push("payload.projectType: must be a string or null");
    }
    validateStringArray("payload.techStack", payload.techStack, BOUNDS.maxTechStack, errors);
    validateStringArray("payload.riskAreas", payload.riskAreas, BOUNDS.maxRiskAreas, errors);

    if (!isPlainObject(payload.index)) {
        errors.push("payload.index: must be an object");
    } else {
        if (!Number.isFinite(payload.index.indexedFiles)) errors.push("payload.index.indexedFiles: must be a finite number");
        if (!Number.isFinite(payload.index.indexedSymbols)) errors.push("payload.index.indexedSymbols: must be a finite number");
        if (!Number.isFinite(payload.index.fileGroups)) errors.push("payload.index.fileGroups: must be a finite number");
        if (typeof payload.index.truncated !== "boolean") errors.push("payload.index.truncated: must be a boolean");
    }

    validateArrayBound("payload.entrypoints", payload.entrypoints, BOUNDS.maxEntrypoints, errors);
    if (Array.isArray(payload.entrypoints)) {
        for (let i = 0; i < payload.entrypoints.length; i += 1) {
            const entry = payload.entrypoints[i];
            const base = `payload.entrypoints.${i}`;
            if (!isPlainObject(entry)) {
                errors.push(`${base}: must be an object`);
                continue;
            }
            if (!(typeof entry.name === "string" || entry.name === null)) errors.push(`${base}.name: must be a string or null`);
            if (!(typeof entry.path === "string" || entry.path === null)) errors.push(`${base}.path: must be a string or null`);
        }
    }

    validateArrayBound("payload.topFiles", payload.topFiles, BOUNDS.maxTopFiles, errors);
    if (Array.isArray(payload.topFiles)) {
        for (let i = 0; i < payload.topFiles.length; i += 1) {
            const file = payload.topFiles[i];
            const base = `payload.topFiles.${i}`;
            if (!isPlainObject(file)) {
                errors.push(`${base}: must be an object`);
                continue;
            }
            if (!isNonEmptyString(file.path)) errors.push(`${base}.path: must be a non-empty string`);
            if (!isNonEmptyString(file.type)) errors.push(`${base}.type: must be a non-empty string`);
            if (!isNonEmptyString(file.description)) errors.push(`${base}.description: must be a non-empty string`);
        }
    }

    validateArrayBound("payload.fileGroups", payload.fileGroups, BOUNDS.maxFileGroups, errors);
    if (Array.isArray(payload.fileGroups)) {
        for (let i = 0; i < payload.fileGroups.length; i += 1) {
            const group = payload.fileGroups[i];
            const base = `payload.fileGroups.${i}`;
            if (!isPlainObject(group)) {
                errors.push(`${base}: must be an object`);
                continue;
            }
            if (typeof group.label !== "string") errors.push(`${base}.label: must be a string`);
            if (typeof group.description !== "string") errors.push(`${base}.description: must be a string`);
        }
    }
}

function validateExecutionPayload(payload, errors) {
    if (!isNonEmptyString(payload.confirmationProtocol)) {
        errors.push("payload.confirmationProtocol: must be a non-empty string");
    }

    if (!isPlainObject(payload.commandPolicy)) {
        errors.push("payload.commandPolicy: must be an object");
    } else {
        if (typeof payload.commandPolicy.arbitraryShell !== "boolean") {
            errors.push("payload.commandPolicy.arbitraryShell: must be a boolean");
        }
        if (!isNonEmptyString(payload.commandPolicy.testExecution)) {
            errors.push("payload.commandPolicy.testExecution: must be a non-empty string");
        }
        if (!isNonEmptyString(payload.commandPolicy.externalSideEffects)) {
            errors.push("payload.commandPolicy.externalSideEffects: must be a non-empty string");
        }
    }

    validateStringArray("payload.mcpCapabilityTiers", payload.mcpCapabilityTiers, BOUNDS.maxCapabilityTiers, errors);
}

function validateVerificationPayload(payload, errors) {
    if (!isPlainObject(payload.taskHealth)) {
        errors.push("payload.taskHealth: must be an object");
    } else {
        const fields = ["count", "withAcceptanceCriteria", "withTestCommand", "withDefinitionOfDone"];
        for (const field of fields) {
            if (!Number.isFinite(payload.taskHealth[field])) {
                errors.push(`payload.taskHealth.${field}: must be a finite number`);
            }
        }
    }

    validateStringArray("payload.warnings", payload.warnings, BOUNDS.maxWarnings, errors);
    validateStringArray("payload.requiredChecks", payload.requiredChecks, BOUNDS.maxRequiredChecks, errors);
}

function validatePayloadByKind(kind, payload, errors) {
    if (kind === "task") {
        validateTaskPayload(payload, errors);
        return;
    }
    if (kind === "context") {
        validateContextPayload(payload, errors);
        return;
    }
    if (kind === "execution") {
        validateExecutionPayload(payload, errors);
        return;
    }
    if (kind === "verification") {
        validateVerificationPayload(payload, errors);
    }
}

export function validateRuntimeContract(contract) {
    const errors = [];
    const warnings = [];
    if (!isPlainObject(contract)) {
        return { valid: false, errors: ["(root): contract must be an object"], warnings: [] };
    }

    for (const legacyField of LEGACY_RUNTIME_CONTRACT_FIELDS) {
        if (Object.hasOwn(contract, legacyField)) {
            errors.push(`${legacyField}: legacy runtime-contract field is not valid in runtime/v1 envelope`);
        }
    }

    if (!Object.hasOwn(contract, "schemaVersion")) {
        errors.push("schemaVersion: missing");
    } else if (contract.schemaVersion !== RUNTIME_JSON_SCHEMA_VERSION) {
        errors.push(`schemaVersion: must be ${RUNTIME_JSON_SCHEMA_VERSION}`);
    }

    if (!Object.hasOwn(contract, "generatedAt")) {
        errors.push("generatedAt: missing");
    } else if (!isNonEmptyString(contract.generatedAt)) {
        errors.push("generatedAt: must be a non-empty string");
    }

    if (!Object.hasOwn(contract, "source")) {
        errors.push("source: missing");
    } else if (!isPlainObject(contract.source)) {
        errors.push("source: must be an object");
    } else {
        if (!isNonEmptyString(contract.source.generatedBy)) {
            errors.push("source.generatedBy: must be a non-empty string");
        }
        validateStringArray("source.inputs", contract.source.inputs, 32, errors);
    }

    if (!Object.hasOwn(contract, "kind")) {
        errors.push("kind: missing");
    } else if (!isNonEmptyString(contract.kind)) {
        errors.push("kind: must be a non-empty string");
    } else if (!RUNTIME_ENVELOPE_KINDS.has(contract.kind)) {
        errors.push(`kind: unsupported runtime/v1 envelope kind: ${contract.kind}`);
    }

    if (!Object.hasOwn(contract, "payload")) {
        errors.push("payload: missing");
    } else if (!isPlainObject(contract.payload)) {
        errors.push("payload: must be an object");
    } else if (RUNTIME_ENVELOPE_KINDS.has(contract.kind)) {
        validatePayloadByKind(contract.kind, contract.payload, errors);
    }

    scanJsonSafety(contract, [], errors);

    return { valid: errors.length === 0, errors, warnings };
}
