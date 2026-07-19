function fail(code) {
  throw new Error(code);
}

function clone(value) {
  return structuredClone(value);
}

function fingerprint(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${fingerprint(value[key])}`).join(",")}}`;
}

export class SettingsReconciler {
  constructor({ inspect, reconcile, schedule = queueMicrotask, maxPasses = 4 }) {
    if (typeof inspect !== "function" || typeof reconcile !== "function" || typeof schedule !== "function") {
      fail("settings-reconciler-port-invalid");
    }
    if (!Number.isInteger(maxPasses) || maxPasses < 1 || maxPasses > 8) fail("settings-reconciler-pass-limit-invalid");
    this.inspect = inspect;
    this.reconcile = reconcile;
    this.schedule = schedule;
    this.maxPasses = maxPasses;
    this.desired = null;
    this.desiredFingerprint = null;
    this.lastStableFingerprint = null;
    this.scheduled = false;
    this.running = false;
    this.mutationPending = false;
    this.totalWrites = 0;
    this.lastPassCount = 0;
  }

  setDesired(desired) {
    const nextFingerprint = fingerprint(desired);
    this.desired = clone(desired);
    if (nextFingerprint === this.desiredFingerprint && nextFingerprint === this.lastStableFingerprint) {
      return { scheduled: false, reason: "already-stable" };
    }
    this.desiredFingerprint = nextFingerprint;
    return this.#request("desired-changed");
  }

  notifyMutation() {
    if (this.desiredFingerprint === null) return { scheduled: false, reason: "no-desired-state" };
    if (this.running) {
      this.mutationPending = true;
      return { scheduled: false, reason: "coalesced-during-reconcile" };
    }
    return this.#request("mutation");
  }

  #request(reason) {
    if (this.scheduled) return { scheduled: false, reason: "already-scheduled" };
    this.scheduled = true;
    this.schedule(() => this.#run());
    return { scheduled: true, reason };
  }

  #run() {
    if (this.running || this.desiredFingerprint === null) return;
    this.scheduled = false;
    this.running = true;
    this.mutationPending = false;
    let passes = 0;
    try {
      while (passes < this.maxPasses) {
        passes += 1;
        const actual = this.inspect();
        const actualFingerprint = fingerprint(actual);
        if (actualFingerprint === this.desiredFingerprint) {
          this.lastStableFingerprint = this.desiredFingerprint;
          this.lastPassCount = passes;
          this.mutationPending = false;
          return;
        }
        const result = this.reconcile(clone(this.desired), clone(actual));
        if (!result || result.changed !== true || !Number.isInteger(result.writeCount)
          || result.writeCount < 1 || result.writeCount > 128) fail("settings-reconciler-write-result-invalid");
        this.totalWrites += result.writeCount;
      }
      this.lastPassCount = passes;
      fail("settings-reconciler-did-not-converge");
    } finally {
      this.running = false;
      this.mutationPending = false;
    }
  }

  snapshot() {
    return {
      desiredFingerprint: this.desiredFingerprint,
      lastStableFingerprint: this.lastStableFingerprint,
      scheduled: this.scheduled,
      running: this.running,
      totalWrites: this.totalWrites,
      lastPassCount: this.lastPassCount,
      maxPasses: this.maxPasses,
    };
  }
}

export function settingsStateFingerprint(value) {
  return fingerprint(value);
}
