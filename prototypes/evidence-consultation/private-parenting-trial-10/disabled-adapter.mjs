export function createRealModelAdapter() {
  throw new Error("REAL_MODEL_TRANSPORT_DISABLED_AUTHORIZATION_ZERO");
}

export function createOfflineInjectedTransport(execute) {
  if (globalThis[Symbol.for("private-parenting-trial-10.offline-lockdown")] !== true) {
    throw new Error("OFFLINE_LOCKDOWN_REQUIRED");
  }
  if (typeof execute !== "function") throw new Error("OFFLINE_EXECUTOR_REQUIRED");
  let attempts = 0;
  let busy = false;
  return Object.freeze({
    kind: "synthetic-offline-only",
    get attempts() { return attempts; },
    async attempt(serialized) {
      if (busy) throw new Error("CONCURRENCY_ONE");
      if (attempts >= 15) throw new Error("ATTEMPT_LIMIT");
      if (typeof serialized !== "string") throw new Error("SERIALIZED_PACKET_REQUIRED");
      attempts += 1;
      busy = true;
      try { return await execute(serialized); } finally { busy = false; }
    },
  });
}
