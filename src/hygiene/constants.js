export const HYGIENE_VERSION = "hygiene/v1";

export const HYGIENE_LIMITS = {
    maxCandidatesPerType: 50,
    maxCandidatesTotal: 200,
    completedTaskArchiveAgeDays: 30,
    staleRuntimeArtifactAgeDays: 30,
    snapshotRetainLines: 200,
    snapshotRotateMaxBytes: 5_000_000,
};

export const HYGIENE_PATHS = {
    archiveTasksDir: ".aidw/archive/tasks",
    archiveSnapshotsDir: ".aidw/archive/snapshots",
    quarantineDir: ".aidw/quarantine",
    snapshotsFile: ".aidw/runtime/snapshots/snapshots.jsonl",
    loopFile: ".aidw/context-loop.jsonl",
    executorStateFile: ".aidw/executor-state.json",
    gateStateFile: ".aidw/confirmation-gate.json",
    sessionsFile: ".aidw/runtime/sessions.jsonl",
    taskRegistryFile: "task/task.md",
};

