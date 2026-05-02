import path from "path";
import { exists, listDirSafe, readText } from "./fs-utils.js";

export const TASK_DIR = "task";

function readTextSafe(filePath) {
    if (!exists(filePath)) {
        return "";
    }

    try {
        return readText(filePath);
    } catch {
        return "";
    }
}

export function listTaskFiles() {
    return listDirSafe(TASK_DIR)
        .filter((fileName) => path.extname(fileName).toLowerCase() === ".md")
        .map((fileName) => `${TASK_DIR}/${fileName}`)
        .filter((filePath) => exists(filePath))
        .sort();
}

function extractTaskId(filePath, content) {
    const basenameMatch = path.basename(filePath).match(/^(T-\d{3})\b/i);

    if (basenameMatch) {
        return basenameMatch[1].toUpperCase();
    }

    const headingMatch = content.match(/^#\s+(T-\d{3})\b/im);

    return headingMatch?.[1]?.toUpperCase() ?? null;
}

function extractTaskTitle(content, id, filePath) {
    const headingMatch = content.match(/^#\s+(.+)$/m);
    const heading = headingMatch?.[1]?.trim();

    if (heading) {
        return id ? heading.replace(new RegExp(`^${id}\\s*`, "i"), "").trim() : heading;
    }

    return path
        .basename(filePath, ".md")
        .replace(/^T-\d{3}-/i, "")
        .replaceAll("-", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function parseTaskFile(filePath) {
    const content = readTextSafe(filePath);
    const id = extractTaskId(filePath, content);
    const title = extractTaskTitle(content, id, filePath);

    return {
        path: filePath,
        id,
        title,
        hasAcceptanceCriteria: /^##\s+Acceptance Criteria\b/im.test(content),
        hasTestCommand: /^##\s+Test Command\b/im.test(content),
        hasDefinitionOfDone: /^##\s+Definition of Done\b/im.test(content),
    };
}

export function getTaskFileMetadata() {
    return listTaskFiles().map(parseTaskFile);
}

export function getTaskHealthSummary(tasks = getTaskFileMetadata()) {
    return {
        count: tasks.length,
        withAcceptanceCriteria: tasks.filter((task) => task.hasAcceptanceCriteria).length,
        withTestCommand: tasks.filter((task) => task.hasTestCommand).length,
        withDefinitionOfDone: tasks.filter((task) => task.hasDefinitionOfDone).length,
    };
}
