// Read-only snapshots of uTools LevelDB. Secrets only enter the local encrypted vault.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { ClassicLevel } from "classic-level";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Core } = require("../runtime/core.cjs");
const { LocalStore } = require("../runtime/storage.cjs");
const { matchModel } = require("../runtime/catalog.cjs");
const source =
  process.env.UTOOLS_DATA_DIR ||
  path.join(
    process.env.APPDATA || path.join(os.homedir(), ".config"),
    "uTools",
  );
const databases = path.join(source, "database");
const core = new Core();
const providers = [];
const originals = [];
let modelPreferences = [];
for (const account of fs.readdirSync(databases)) {
  const folder = path.join(databases, account);
  if (!fs.statSync(folder).isDirectory()) continue;
  const target = path.resolve(
    ".local/migration-snapshots",
    account + "-" + Date.now(),
  );
  fs.mkdirSync(target, { recursive: true });
  for (const file of fs.readdirSync(folder))
    if (!["LOCK", "LOG", "LOG.old"].includes(file))
      fs.copyFileSync(path.join(folder, file), path.join(target, file));
  const db = new ClassicLevel(target, {
    valueEncoding: "utf8",
    createIfMissing: false,
  });
  async function document(key) {
    try {
      const meta = JSON.parse(await db.get("\xffdocument-store\xff" + key));
      if (meta.deleted) return null;
      const sequence = meta.rev_map?.[meta.winningRev] || meta.seq;
      return JSON.parse(
        await db.get(
          "\xffby-sequence\xff" + String(sequence).padStart(16, "0"),
        ),
      );
    } catch {
      return null;
    }
  }
  const proxy = await document("z3jno9af/apiProxy");
  if (proxy) {
    const records = Array.isArray(proxy.value) ? proxy.value : [proxy.value];
    for (const item of records) {
      if (!item || Number(item.value) !== 100 || !item.url) continue;
      const identity = crypto
        .createHash("sha256")
        .update(item.id + "\0" + item.url + "\0" + item.apiKey)
        .digest("hex")
        .slice(0, 24);
      if (providers.some((p) => p.id === "migrated-" + identity)) continue;
      const models = [];
      providers.push({
        id: "migrated-" + identity,
        name: item.name || "导入的供应商",
        baseURL: item.url
          .replace(/\/(chat\/completions|responses)\/?$/, "")
          .replace(/\/+$/, ""),
        protocol: "openai",
        keys: item.apiKey ? [item.apiKey] : [],
        models,
        availableModels: [],
        modelConfigs: {},
        enabled: true,
        defaultEffort: "auto",
        legacy: {
          id: item.id,
          isOpen: item.isOpen,
          isParseStream: item.isParseStream,
        },
      });
      originals.push({ account, ...item });
    }
  }
  for await (const [key] of db.iterator()) {
    if (key.startsWith("\xffdocument-store\xffz3jno9af/ai@")) {
      const row = await document(key.slice("\xffdocument-store\xff".length));
      if (row?.params?.model)
        modelPreferences.push({ apiId: row.api_id, model: row.params.model });
    }
  }
  await db.close();
}
if (!providers.length) throw new Error("没有发现 ChatGPT.好友 的自定义供应商");
let catalog = {};
try {
  catalog = await core.catalog();
} catch {}
for (const provider of providers) {
  try {
    provider.availableModels = await core.models(provider);
    const preferred = modelPreferences
      .filter((x) => x.apiId === provider.legacy.id)
      .map((x) => x.model)
      .filter((m) => provider.availableModels.includes(m));
    const candidates = preferred.length
      ? preferred
      : provider.availableModels
          .filter((m) =>
            /gpt-5|claude-sonnet|gemini.*flash|deepseek-chat/i.test(m),
          )
          .slice(0, 3);
    provider.models = [
      ...new Set(
        candidates.length ? candidates : provider.availableModels.slice(0, 2),
      ),
    ];
    for (const model of provider.availableModels) {
      const config = matchModel(model, catalog);
      if (config) provider.modelConfigs[model] = config;
    }
    console.log(
      JSON.stringify({
        provider: provider.name,
        models: provider.availableModels.length,
        startup: provider.models,
        matched: Object.keys(provider.modelConfigs).length,
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        provider: provider.name,
        error: String(error.message).replace(/sk-[\w-]+/g, "[redacted]"),
      }),
    );
  }
}
const data = { at: Date.now(), providers, originals };
await core.store.write("migration", data);
const check = core.store.read("migration");
if (
  check.providers.length !== providers.length ||
  !check.providers.every(
    (p, i) => p.keys[0] === originals[i].apiKey && p.name === originals[i].name,
  )
)
  throw new Error("迁移完整性校验失败");
const existing = core.load();
if (existing?.settings?.version) {
  const byId = new Map(existing.settings.providers.map((p) => [p.id, p]));
  for (const p of providers) if (!byId.has(p.id)) byId.set(p.id, p);
  await core.save({
    ...existing,
    settings: {
      ...existing.settings,
      providers: [...byId.values()],
      migration: {
        count: providers.length,
        at: Date.now(),
        source: "ChatGPT.好友",
      },
    },
  });
}
console.log(
  JSON.stringify({
    migrated: providers.length,
    keysVerified: true,
    originalDataUnchanged: true,
    vault: core.store.directory,
  }),
);
