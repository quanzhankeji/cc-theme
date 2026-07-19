function clone(value) {
  return structuredClone(value);
}

import { validateRuntimeValue } from "./theme-normalizer.mjs";

export class SettingsSession {
  constructor({ initialState, preview, persist, rollback, validate = validateRuntimeValue, debounceMs = 180, setTimer = setTimeout, clearTimer = clearTimeout }) {
    if (typeof preview !== "function" || typeof persist !== "function" || typeof rollback !== "function") {
      throw new Error("settings-port-invalid");
    }
    this.preview = preview;
    this.persist = persist;
    this.rollback = rollback;
    this.validate = validate;
    this.debounceMs = debounceMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.current = clone(initialState);
    this.committed = clone(initialState);
    this.revision = Number(initialState.revision ?? 0);
    this.pending = null;
    this.timer = null;
    this.drainPromise = null;
    this.lastError = null;
  }

  update(tokenId, value) {
    if (!/^[a-z][A-Za-z0-9.-]{2,79}$/.test(tokenId)) throw new Error("settings-token-invalid");
    const validatedValue = this.validate(tokenId, value);
    this.revision += 1;
    const previous = clone(this.current);
    const candidate = {
      ...clone(this.current),
      revision: this.revision,
      values: { ...clone(this.current.values ?? {}), [tokenId]: clone(validatedValue) },
    };
    try {
      this.preview(clone(candidate));
    } catch {
      this.current = previous;
      Promise.resolve(this.rollback(clone(previous))).catch(() => {});
      throw new Error("settings-preview-failed");
    }
    this.current = candidate;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.enqueue(this.current);
    }, this.debounceMs);
    return clone(this.current);
  }

  enqueue(state) {
    this.pending = clone(state);
    if (!this.drainPromise) this.drainPromise = this.drain();
    return this.drainPromise;
  }

  async drain() {
    try {
      while (this.pending) {
        const candidate = this.pending;
        this.pending = null;
        try {
          await this.persist(clone(candidate));
          this.committed = clone(candidate);
        } catch {
          this.lastError = new Error("settings-persist-failed");
          if (!this.pending && candidate.revision === this.current.revision) {
            this.current = clone(this.committed);
            try {
              this.preview(clone(this.committed));
            } catch {
              this.lastError = new Error("settings-preview-rollback-failed");
            }
            try {
              await this.rollback(clone(this.committed));
            } catch {
              this.lastError = new Error("settings-state-rollback-failed");
            }
          }
        }
        if (this.current.revision > this.committed.revision && !this.pending) this.pending = clone(this.current);
      }
    } finally {
      this.drainPromise = null;
    }
  }

  async flush() {
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    await this.enqueue(this.current);
    while (this.drainPromise) await this.drainPromise;
    if (this.lastError) {
      const error = this.lastError;
      this.lastError = null;
      throw error;
    }
    return clone(this.committed);
  }

  snapshot() {
    return { current: clone(this.current), committed: clone(this.committed), revision: this.revision };
  }
}
