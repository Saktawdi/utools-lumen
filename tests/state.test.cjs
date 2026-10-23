const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const path = require("node:path");
const bundled = buildSync({
  entryPoints: [path.join(__dirname, "../src/state-data.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
}).outputFiles[0].text;
const compiled = new Module(path.join(__dirname, "state-bundle.cjs"), module);
compiled.filename = path.join(__dirname, "state-bundle.cjs");
compiled._compile(bundled, compiled.filename);
const { mergeState, importBackup, exportBackup } = compiled.exports;
function workspace() {
  return mergeState({
    settings: {
      providers: [
        {
          id: "p",
          name: "Provider",
          protocol: "openai",
          baseURL: "https://example.test/v1",
          keys: ["private-key"],
          headers: { Authorization: "private-header" },
          models: ["m"],
          availableModels: ["m"],
          modelConfigs: {},
          enabled: true,
          legacy: { apiKey: "legacy-secret" },
        },
      ],
      search: { keys: ["search-secret"] },
    },
    conversations: [
      {
        id: "c",
        title: "Saved",
        messages: [{ id: "m", role: "user", content: "hello", createdAt: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
}
test("keyless backups strip credentials including unknown provider fields; restore preserves existing keys", () => {
  const original = workspace();
  const backup = exportBackup(original, false);
  const json = JSON.stringify(backup);
  for (const secret of [
    "private-key",
    "private-header",
    "legacy-secret",
    "search-secret",
  ])
    assert.equal(json.includes(secret), false);
  const restored = importBackup(backup, original).state;
  assert.deepEqual(restored.settings.providers[0].keys, ["private-key"]);
  assert.equal(
    restored.settings.providers[0].headers.Authorization,
    "private-header",
  );
  assert.deepEqual(restored.settings.search.keys, ["search-secret"]);
  assert.equal(restored.conversations[0].messages[0].content, "hello");
});
test("malformed imports fail atomically instead of replacing live providers or crashing the UI", () => {
  const original = workspace();
  const snapshot = structuredClone(original);
  for (const raw of [
    { providers: [{ models: "not-an-array" }] },
    { providers: [{ baseURL: "file:///private" }] },
    { providers: [{ keys: [17] }] },
    { providers: [], settings: { skins: [] } },
    { providers: [], settings: { customTools: [{ name: "bad" }] } },
    { providers: [], settings: { toolPermission: "invalid" } },
    {
      providers: [],
      conversations: [
        {
          id: "x",
          title: "x",
          messages: [{ id: "bad", role: "system", content: "" }],
        },
      ],
    },
  ])
    assert.throws(() => importBackup(raw, original));
  assert.deepEqual(original, snapshot);
});
test("tool permission defaults to prompt for old data and survives backup restoration", () => {
  const original = workspace();
  assert.equal(original.settings.toolPermission, "prompt");
  original.settings.toolPermission = "always_allow";
  const backup = exportBackup(original, false);
  assert.equal(
    importBackup(backup, workspace()).state.settings.toolPermission,
    "always_allow",
  );
  assert.equal(
    mergeState({
      ...original,
      settings: { ...original.settings, toolPermission: "invalid" },
    }).settings.toolPermission,
    "prompt",
  );
});
test("provider JSON supports legacy apiKey, deduplicates models and merges without losing conversations", () => {
  const original = workspace();
  const restored = importBackup(
    [
      {
        id: "new",
        name: "Local",
        url: "http://127.0.0.1:9000/v1",
        apiKey: "local",
        models: ["m", "m", "n"],
      },
    ],
    original,
  );
  assert.equal(restored.count, 1);
  assert.equal(restored.state.settings.providers.length, 2);
  assert.deepEqual(restored.state.settings.providers[1].models, ["m", "n"]);
  assert.deepEqual(restored.state.settings.providers[1].keys, ["local"]);
  assert.deepEqual(restored.state.conversations, original.conversations);
});
