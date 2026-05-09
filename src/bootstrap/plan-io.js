import { BOOTSTRAP_VERSION } from "./constants.js";
import { pickPlanObject, readJsonPayload } from "../runtime/json-payload.js";

export function readBootstrapPlanPayload(source) {
    return readJsonPayload(source, { missingPathError: "plan path is required" });
}

export function getBootstrapPlanFromPayload(payload) {
    const plan = pickPlanObject(payload);
    if (plan.bootstrapVersion !== BOOTSTRAP_VERSION) {
        throw new Error("unsupported bootstrap plan version");
    }
    if (!Array.isArray(plan.ops)) {
        throw new Error("plan.ops must be an array");
    }
    return plan;
}
