// Generated from src/model-catalog.ts by scripts/sync-catalog.mjs.
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toCommonJS = (mod) =>
  __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var stdin_exports = {};
__export(stdin_exports, {
  flattenCatalog: () => flattenCatalog,
  matchModel: () => matchModel,
  normalize: () => normalize,
});
module.exports = __toCommonJS(stdin_exports);
const text = (value) =>
  typeof value === "string" ? value.normalize("NFKC").trim() : "";
const tokens = (id) =>
  text(id)
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1-$2")
    .match(/[\p{L}\p{N}]+/gu) || [];
const normalize = (id) => tokens(id).join("-");
const providerKey = (id) => normalize(id).replace(/-/g, "");
const bare = (id) => id.slice(id.lastIndexOf("/") + 1);
const strings = (value) =>
  Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const publishers = /* @__PURE__ */ new Set([
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
const publisherAliases = {
  deepseekai: "deepseek",
  mistralai: "mistral",
  qwen: "alibaba",
  moonshot: "moonshotai",
  zhipu: "zai",
  zhipuai: "zai",
};
const publisher = (id) => publisherAliases[providerKey(id)] || providerKey(id);
const referenceKey = (id) => {
  const parts = id.split("/");
  return [...parts.slice(0, -1).map(publisher), normalize(parts.at(-1))].join(
    "/",
  );
};
const modifiers = /* @__PURE__ */ new Set([
  "latest",
  "preview",
  "stable",
  "nightly",
  "beta",
  "alpha",
  "experimental",
  "exp",
  "free",
  "online",
  "chat",
  "instruct",
  "instruction",
  "thinking",
  "nonthinking",
  "nothinking",
  "reasoning",
  "high",
  "low",
  "medium",
  "minimal",
  "xhigh",
  "none",
  "disabled",
  "tiered",
  "agent",
  "antigravity",
  "cc",
  "format",
  "custom",
  "proxy",
  "api",
  "official",
  "\u514D\u8D39",
  "\u5B98\u65B9",
  "\u76F4\u8FDE",
  "\u9006\u5411",
]);
const validMonthDay = (month, day) =>
  Number(month) >= 1 &&
  Number(month) <= 12 &&
  Number(day) >= 1 &&
  Number(day) <= 31;
const dateLength = (parts) => {
  const last = parts.at(-1) || "";
  if (
    /^20\d{6}$/.test(last) &&
    validMonthDay(last.slice(4, 6), last.slice(6, 8))
  )
    return 1;
  if (/^\d{4}$/.test(last) && validMonthDay(last.slice(0, 2), last.slice(2, 4)))
    return 1;
  const end = parts.slice(-3);
  if (
    /^20\d{2}$/.test(end[0] || "") &&
    /^\d{2}$/.test(end[1] || "") &&
    /^\d{2}$/.test(end[2] || "") &&
    validMonthDay(end[1], end[2])
  )
    return 3;
  return 0;
};
const variants = (id) => {
  const parts = tokens(id);
  const result = [parts.join("-")];
  while (parts.length > 1) {
    const effort =
      parts.at(-2) === "extra" && /^(?:low|high)$/.test(parts.at(-1)) ? 2 : 0;
    const count =
      dateLength(parts) || effort || (modifiers.has(parts.at(-1)) ? 1 : 0);
    if (!count || parts.length <= count) break;
    parts.splice(-count);
    result.push(parts.join("-"));
  }
  return result;
};
function flattenCatalog(raw) {
  const result = {};
  for (const [pid, provider] of Object.entries(raw || {})) {
    if (!provider || typeof provider !== "object") continue;
    const models = provider.models;
    if (!models || typeof models !== "object" || Array.isArray(models))
      continue;
    for (const [key, value] of Object.entries(models)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const model = value;
      result[pid + "/" + key] = {
        ...model,
        id: text(model.id) || text(model.modelId) || key,
        providerId: text(model.providerId) || pid,
      };
    }
  }
  return result;
}
const toConfig = (model) => {
  const levels = /* @__PURE__ */ new Set();
  let reasoningMode = "effort";
  for (const option of model.reasoning_options || []) {
    if (option.type === "effort")
      for (const level of option.values || []) levels.add(level);
    if (option.type === "toggle") {
      levels.add("none");
      reasoningMode = "toggle";
    }
    if (option.type === "budget") reasoningMode = "budget";
  }
  return {
    vision: (model.modalities?.input || []).includes("image"),
    reasoning: model.reasoning === true,
    tools: model.tool_call !== false,
    context: model.limit?.context,
    output: model.limit?.output,
    levels: [...levels],
    reasoningMode,
    matchedId: model.id,
    source: "models.dev",
  };
};
const signature = (model) => {
  const { matchedId: _id, source: _source, ...config } = toConfig(model);
  return JSON.stringify({
    ...config,
    levels: [...(config.levels || [])].sort(),
  });
};
const add = (map, key, row) => {
  if (!key) return;
  const rows = map.get(key) || [];
  if (!rows.includes(row)) rows.push(row);
  map.set(key, rows);
};
const buildIndex = (raw) => {
  const index = {
    full: /* @__PURE__ */ new Map(),
    ids: /* @__PURE__ */ new Map(),
    aliases: /* @__PURE__ */ new Map(),
    variants: /* @__PURE__ */ new Map(),
    results: /* @__PURE__ */ new Map(),
  };
  const entries = Object.entries(raw).flatMap(([key, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    if ("models" in value)
      return Object.entries(flattenCatalog({ [key]: value }));
    return [[key, value]];
  });
  for (const [key, value] of entries) {
    const record = value;
    const id = text(record.id) || text(record.modelId) || key;
    const providerId =
      text(record.providerId) ||
      (key.includes("/") ? key.slice(0, key.indexOf("/")) : "");
    const model = { ...record, id, providerId };
    const variantKeys = variants(bare(id));
    const row = {
      model,
      publisher: publisher(providerId),
      identity: variantKeys.at(-1),
    };
    const ids = [...new Set([id, text(record.modelId)].filter(Boolean))];
    for (const value2 of ids) {
      add(index.full, referenceKey(value2), row);
      add(index.ids, normalize(bare(value2)), row);
      if (providerId)
        add(index.full, referenceKey(providerId + "/" + value2), row);
      for (const variant of (value2 === id
        ? variantKeys
        : variants(bare(value2))
      ).slice(1))
        add(index.variants, variant, row);
    }
    const labels = [text(record.name), text(record.displayName)].filter(
      (label) =>
        /\d/.test(label) ||
        ids.some((value2) => normalize(bare(value2)) === normalize(label)),
    );
    for (const alias of [
      text(record.alias),
      ...strings(record.aliases),
      ...labels,
    ]) {
      add(index.aliases, normalize(alias), row);
      add(index.aliases, normalize(bare(alias)), row);
    }
  }
  return index;
};
const select = (matches, scopes) => {
  let rows = [...new Set(matches)];
  for (const scope of scopes) {
    const own = rows.filter((row) => row.publisher === scope);
    if (own.length) {
      rows = own;
      break;
    }
    if (publishers.has(scope)) {
      const namespaced = rows.filter((row) =>
        row.model.id
          .split("/")
          .slice(0, -1)
          .some((part) => publisher(part) === scope),
      );
      if (!namespaced.length) return void 0;
      rows = namespaced;
      break;
    }
  }
  if (new Set(rows.map((row) => row.identity)).size > 1) return null;
  const originals = rows.filter((row) => publishers.has(row.publisher));
  if (originals.length) rows = originals;
  if (
    rows.length > 1 &&
    new Set(rows.map((row) => (row.signature ??= signature(row.model)))).size >
      1
  )
    return null;
  return rows[0]?.model || null;
};
const cache = /* @__PURE__ */ new WeakMap();
function matchModel(id, raw) {
  const query = text(id);
  if (!query || !raw || typeof raw !== "object") return null;
  let index = cache.get(raw);
  if (!index) {
    index = buildIndex(raw);
    cache.set(raw, index);
  }
  if (index.results.has(query)) {
    const cached = index.results.get(query);
    return cached ? toConfig(cached) : null;
  }
  const scopes = query
    .split("/")
    .slice(0, -1)
    .reverse()
    .filter((part) => !/^models?$/i.test(part))
    .map(publisher);
  const keys = [
    .../* @__PURE__ */ new Set([normalize(query), normalize(bare(query))]),
  ];
  const lookup = (map, key) => {
    let rows = map.get(key);
    if (
      rows?.length &&
      (map === index.full || map === index.ids) &&
      !rows.some((row) => publishers.has(row.publisher))
    ) {
      const originals = (
        index.variants.get(key.split("/").at(-1)) || []
      ).filter((row) => publishers.has(row.publisher));
      if (originals.length) rows = [...rows, ...originals];
    }
    return rows?.length ? select(rows, scopes) : void 0;
  };
  const finish = (model) => {
    if (index.results.size >= 4096) index.results.clear();
    index.results.set(query, model);
    return model ? toConfig(model) : null;
  };
  const complete = lookup(index.full, referenceKey(query));
  if (complete !== void 0) return finish(complete);
  for (const map of [index.ids, index.aliases]) {
    for (const key of keys) {
      const found = lookup(map, key);
      if (found !== void 0) return finish(found);
    }
  }
  const simplified = variants(bare(query));
  for (const key of simplified) {
    for (const map of [index.full, index.ids, index.variants, index.aliases]) {
      const found = lookup(map, key);
      if (found !== void 0) return finish(found);
    }
  }
  for (const key of simplified) {
    const parts = key.split("-");
    for (let start = 1; start < parts.length - 1; start++) {
      const tail = parts.slice(start);
      const compact = tail.join("");
      if (
        !/^[a-z]/.test(tail[0]) ||
        (compact.length < 4 && !/^o\d+$/.test(compact))
      )
        continue;
      for (const map of [
        index.full,
        index.ids,
        index.variants,
        index.aliases,
      ]) {
        const found = lookup(map, tail.join("-"));
        if (found !== void 0) return finish(found);
      }
    }
  }
  return finish(null);
}
