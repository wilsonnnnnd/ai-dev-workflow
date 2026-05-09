import { serializeJson } from "../runtime/serialize.js";
import { pickPlanObject, readJsonPayload } from "../runtime/json-payload.js";
import { BOOTSTRAP_VERSION } from "./constants.js";

export function inspectBootstrapPlan({ planSource } = {}) {
    const payload = readJsonPayload(planSource, { missingPathError: "plan path is required" });
    const plan = pickPlanObject(payload);
    if (plan.bootstrapVersion !== BOOTSTRAP_VERSION) {
        throw new Error("unsupported bootstrap plan version");
    }
    const ops = Array.isArray(plan.ops) ? plan.ops : [];
    const counts = {
        ops: ops.length,
        mkdir: ops.filter((o) => o?.op === "mkdir").length,
        writeFile: ops.filter((o) => o?.op === "writeFile").length,
        copyTemplate: ops.filter((o) => o?.op === "copyTemplate").length,
        snapshot: ops.filter((o) => o?.op === "snapshot").length,
    };
    const sample = ops
        .filter((o) => o && typeof o.path === "string")
        .slice(0, 40)
        .map((o) => ({ op: o.op, path: o.path }));
    return {
        ok: true,
        bootstrapVersion: plan.bootstrapVersion,
        writeMode: plan.writeMode ?? "create-only",
        digest: plan.digest ?? null,
        pauseToken: plan.pauseToken ?? null,
        counts,
        sample,
        plan,
        output: serializeJson({ ok: true, bootstrapVersion: plan.bootstrapVersion, writeMode: plan.writeMode, digest: plan.digest, pauseToken: plan.pauseToken, counts, sample }),
    };
}
