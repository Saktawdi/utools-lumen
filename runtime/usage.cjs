const crypto = require("node:crypto");
const nonnegative = (n) =>
  Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
function normalizeUsage(raw = {}, protocol = "openai") {
  let input, output, cached, write, reasoning;
  if (protocol === "anthropic") {
    cached = raw.cache_read_input_tokens;
    write = raw.cache_creation_input_tokens;
    input =
      nonnegative(raw.input_tokens) + nonnegative(cached) + nonnegative(write);
    output = raw.output_tokens;
  } else if (protocol === "google") {
    input = raw.promptTokenCount;
    reasoning = raw.thoughtsTokenCount;
    output = nonnegative(raw.candidatesTokenCount) + nonnegative(reasoning);
    cached = raw.cachedContentTokenCount;
  } else {
    input = raw.prompt_tokens ?? raw.input_tokens;
    output = raw.completion_tokens ?? raw.output_tokens;
    cached = (raw.prompt_tokens_details || raw.input_tokens_details)
      ?.cached_tokens;
    reasoning = (raw.completion_tokens_details || raw.output_tokens_details)
      ?.reasoning_tokens;
  }
  return {
    input: nonnegative(input),
    output: nonnegative(output),
    ...(cached !== undefined ? { cachedInput: nonnegative(cached) } : {}),
    ...(write !== undefined ? { cacheWrite: nonnegative(write) } : {}),
    ...(reasoning !== undefined ? { reasoning: nonnegative(reasoning) } : {}),
  };
}
class UsageLedger {
  constructor(store) {
    this.store = store;
    this.data = null;
    this.pending = Promise.resolve();
  }
  load() {
    if (!this.data) {
      this.data = this.store.read("usage", null) || {
        records: [],
        since: Date.now(),
      };
      // Seed usage from older conversations exactly once; never count new messages twice.
      if (!this.data.migrated) {
        const state = this.store.read("state", null);
        for (const c of state?.conversations || [])
          for (const m of c.messages || []) {
            if (!m.usage || m.role !== "assistant") continue;
            const p = state.settings?.providers?.find((p) =>
              c.modelKey?.startsWith(p.id + ":"),
            );
            this.data.records.push({
              id: "legacy-" + m.id,
              startedAt: m.createdAt,
              completedAt: m.createdAt,
              providerId: p?.id || "legacy",
              providerName: p?.name || "历史供应商",
              model: m.model || "历史模型",
              kind: "chat",
              status: m.error
                ? "error"
                : m.interrupted
                  ? "cancelled"
                  : "success",
              reported: true,
              legacy: true,
              ...m.usage,
            });
          }
        this.data.migrated = true;
        const snapshot = structuredClone(this.data);
        this.pending = this.store.write("usage", snapshot);
        // Reads can happen before the first new request. Surface any failure on the next operation.
        this.pending.catch(() => {});
      }
    }
    return this.data;
  }
  async append(record) {
    const data = this.load();
    data.records.push({
      id: crypto.randomUUID(),
      input: 0,
      output: 0,
      ...record,
    });
    const snapshot = structuredClone(data);
    this.pending = this.pending
      .catch(() => {})
      .then(() => this.store.write("usage", snapshot));
    await this.pending;
  }
  async read() {
    const data = this.load();
    await this.pending;
    return structuredClone(data);
  }
}
module.exports = { UsageLedger, normalizeUsage };
