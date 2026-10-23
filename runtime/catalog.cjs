function normalize(id) {
  return id.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function bare(id) {
  return id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
}
function strip(id) {
  return id.replace(
    /(?:[-_]?\d{4}[-_]?\d{2}[-_]?\d{2}|[-_](?:latest|preview|stable|nightly))$/i,
    "",
  );
}
function flattenCatalog(raw) {
  const result = {};
  for (const [pid, p] of Object.entries(raw || {})) {
    if (!p || typeof p !== "object") continue;
    for (const [id, m] of Object.entries(p.models || {}))
      if (m && typeof m === "object")
        result[pid + "/" + id] = { ...m, id: m.id || id, providerId: pid };
  }
  return result;
}
const canonical = new Set([
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "alibaba",
  "moonshotai",
  "xai",
  "mistral",
  "cohere",
  "zai",
  "minimax",
]);
const cache = new WeakMap();
function matchModel(id, entries) {
  const steps = [
    (v) => normalize(v),
    (v) => normalize(strip(v)),
    (v) => normalize(bare(v)),
    (v) => normalize(strip(bare(v))),
  ];
  let indexes = cache.get(entries);
  if (!indexes) {
    indexes = steps.map(() => new Map());
    for (const model of Object.values(entries)) {
      if (!model || typeof model.id !== "string") continue;
      steps.forEach((key, i) => {
        const value = key(model.id);
        const rows = indexes[i].get(value) || [];
        rows.push(model);
        indexes[i].set(value, rows);
      });
    }
    cache.set(entries, indexes);
  }
  for (let i = 0; i < steps.length; i++) {
    const key = steps[i];
    const target = key(id);
    const matches = indexes[i].get(target) || [];
    if (!matches.length) continue;
    const explicit = id.includes("/")
      ? matches.find(
          (m) => normalize(m.providerId || "") === normalize(id.split("/")[0]),
        )
      : undefined;
    const originals = matches.filter((m) =>
      canonical.has(normalize(m.providerId || "")),
    );
    if (explicit || originals.length === 1)
      return toConfig(explicit || originals[0]);
    const signatures = new Set(
      matches.map((m) =>
        JSON.stringify([
          m.reasoning,
          m.tool_call,
          m.modalities?.input,
          m.limit?.context,
          m.limit?.output,
          m.reasoning_options,
        ]),
      ),
    );
    if (signatures.size > 1) {
      const own = matches.find(
        (m) => normalize(m.providerId) === normalize(id.split("/")[0]),
      );
      if (!own) continue;
      return toConfig(own);
    }
    return toConfig(matches[0]);
  }
  return null;
}
function toConfig(m) {
  const levels = new Set();
  let mode = "effort";
  for (const option of m.reasoning_options || []) {
    if (option.type === "effort")
      for (const l of option.values || []) levels.add(l);
    if (option.type === "toggle") {
      levels.add("none");
      mode = "toggle";
    }
    if (option.type === "budget") mode = "budget";
  }
  return {
    vision: (m.modalities?.input || []).includes("image"),
    reasoning: m.reasoning === true,
    tools: m.tool_call !== false,
    context: m.limit?.context,
    output: m.limit?.output,
    levels: [...levels],
    reasoningMode: mode,
    matchedId: m.id,
    source: "models.dev",
  };
}
module.exports = { normalize, flattenCatalog, matchModel };
