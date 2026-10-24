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
const { mergeState, importBackup, exportBackup, parseSkin, agentSettings } =
  compiled.exports;
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
      imageProviders: [
        {
          id: "image-provider",
          name: "Images",
          protocol: "openai-images",
          baseURL: "https://example.test/v1",
          models: ["image-model"],
          availableModels: [],
          enabled: true,
          keys: ["image-secret"],
          headers: { Authorization: "image-header" },
          legacy: { apiKey: "image-legacy-secret" },
        },
      ],
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
    "image-secret",
    "image-header",
    "image-legacy-secret",
  ])
    assert.equal(json.includes(secret), false);
  const restored = importBackup(backup, original).state;
  assert.deepEqual(restored.settings.providers[0].keys, ["private-key"]);
  assert.equal(
    restored.settings.providers[0].headers.Authorization,
    "private-header",
  );
  assert.deepEqual(restored.settings.search.keys, ["search-secret"]);
  assert.deepEqual(restored.settings.imageProviders[0].keys, ["image-secret"]);
  assert.deepEqual(restored.settings.imageProviders[0].headers, {
    Authorization: "image-header",
  });
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

test("reasoning levels repair legacy combined values and preserve individual levels through JSON backup", () => {
  const original = workspace();
  original.settings.providers[0].modelConfigs.m = {
    reasoning: true,
    reasoningMode: "effort",
    source: "自定义",
    levels: [
      "low，high",
      "medium;max；xhigh",
      " high ",
      "custom-level\r\nlow",
      "budget:8192",
      "",
      "custom level",
    ],
  };
  const expected = [
    "low",
    "high",
    "medium",
    "max",
    "xhigh",
    "custom-level",
    "budget:8192",
    "custom level",
  ];
  const snapshot = structuredClone(original);
  const loaded = mergeState(original);
  assert.deepEqual(
    loaded.settings.providers[0].modelConfigs.m.levels,
    expected,
  );
  assert.equal(
    loaded.settings.providers[0].modelConfigs.m.reasoningMode,
    "effort",
  );
  assert.equal(loaded.settings.providers[0].modelConfigs.m.source, "自定义");
  assert.deepEqual(original, snapshot);
  const restored = importBackup(
    JSON.parse(JSON.stringify(exportBackup(original, false))),
    workspace(),
  ).state;
  assert.deepEqual(
    restored.settings.providers[0].modelConfigs.m.levels,
    expected,
  );
  assert.deepEqual(restored.settings.providers[0].keys, ["private-key"]);
  const cleared = importBackup(
    [
      {
        ...original.settings.providers[0],
        modelConfigs: { m: { levels: [" ,，;；、\r\n "] } },
      },
    ],
    original,
  ).state;
  assert.deepEqual(cleared.settings.providers[0].modelConfigs.m.levels, []);
});

test("image references in backups validate metadata without embedding local image files", () => {
  const original = workspace();
  const raw = exportBackup(original, false);
  const message = raw.conversations[0].messages[0];
  message.generatedImages = [{ id: "asset-1", mime: "image/png", size: 1024 }];
  assert.deepEqual(
    importBackup(raw, original).state.conversations[0].messages[0]
      .generatedImages,
    message.generatedImages,
  );
  for (const bad of [
    "not-an-array",
    [null],
    [{ id: "../private", mime: "image/png", size: 1 }],
    [{ id: "asset-1", mime: "text/html", size: 1 }],
    [{ id: "asset-1", mime: "image/png", size: -1 }],
  ]) {
    message.generatedImages = bad;
    assert.throws(() => importBackup(raw, original), /生成图片/);
  }
  assert.equal(
    original.conversations[0].messages[0].generatedImages,
    undefined,
  );
});

test("legacy preferences gain split chat layout; invalid appearance data falls back without losing chat history", () => {
  const old = workspace();
  assert.equal(old.settings.chatLayout, "split");
  const loaded = mergeState({
    ...old,
    settings: {
      ...old.settings,
      chatLayout: "invalid",
      skin: "missing",
      userAvatar: "https://example.test/avatar.png",
      skins: [{ id: "broken" }],
    },
  });
  assert.equal(loaded.settings.chatLayout, "split");
  assert.equal(loaded.settings.userAvatar, undefined);
  assert.equal(loaded.settings.skin, "jade");
  assert.deepEqual(loaded.conversations, old.conversations);
});

test("avatars, wallpaper and all custom bubble preferences survive disk JSON and backup restoration", () => {
  const original = workspace();
  const image = "data:image/webp;base64,UklGRg==";
  original.settings.chatLayout = "single";
  original.settings.userAvatar = image;
  original.settings.agentAvatar = image;
  original.settings.skin = "custom-test";
  const skin = {
    id: "custom-test",
    name: "My skin",
    description: "Local",
    custom: true,
    accent: "#336699",
    darkAccent: "#99bbff",
    background: "#ffffff",
    darkBackground: "#202020",
    backgroundImage: image,
    backgroundBlur: 24,
    backgroundOpacity: 0.35,
    backgroundPosition: "top",
    bubbleStyle: "outline",
    bubbleRadius: 9,
    bubbleOpacity: 0.8,
    userBubble: "#eefaff",
    darkUserBubble: "#203040",
    agentBubble: "#ffffff",
    darkAgentBubble: "#333333",
  };
  original.settings.skins = [skin];
  const onDisk = mergeState(JSON.parse(JSON.stringify(original)));
  const restored = importBackup(
    JSON.parse(JSON.stringify(exportBackup(onDisk, false))),
    workspace(),
  ).state;
  assert.equal(restored.settings.chatLayout, "single");
  assert.equal(restored.settings.userAvatar, image);
  assert.equal(restored.settings.agentAvatar, image);
  assert.equal(restored.settings.skin, skin.id);
  assert.deepEqual(restored.settings.skins, [skin]);
  const cleared = importBackup(
    { providers: [], settings: { userAvatar: "", agentAvatar: "" } },
    restored,
  ).state;
  assert.equal(cleared.settings.userAvatar, undefined);
  assert.equal(cleared.settings.agentAvatar, undefined);
});

test("appearance imports reject remote images, active content and excessive settings atomically", () => {
  const original = workspace();
  const snapshot = structuredClone(original);
  for (const badImage of [
    "https://example.test/image.png",
    "file:///private.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,');url(https://example.test)",
    "data:image/png;base64," + "A".repeat(4 * 1024 * 1024),
  ]) {
    assert.throws(
      () =>
        importBackup(
          { providers: [], settings: { userAvatar: badImage } },
          original,
        ),
      /本地图片/,
    );
    assert.throws(
      () =>
        parseSkin({ ...original.settings.skins[0], backgroundImage: badImage }),
      /本地图片/,
    );
  }
  for (const patch of [
    { backgroundBlur: -1 },
    { backgroundBlur: 33 },
    { backgroundOpacity: 1.1 },
    { bubbleOpacity: 0.1 },
    { bubbleRadius: Infinity },
    { bubbleStyle: "unknown" },
    { backgroundPosition: "url(example)" },
    { userBubble: "red; color: red" },
  ]) {
    assert.throws(() =>
      importBackup(
        {
          providers: [],
          settings: { skins: [{ ...original.settings.skins[0], ...patch }] },
        },
        original,
      ),
    );
  }
  assert.throws(
    () =>
      importBackup(
        { providers: [], settings: { chatLayout: "unknown" } },
        original,
      ),
    /聊天布局/,
  );
  assert.deepEqual(original, snapshot);
});

test("Agent transport omits appearance images while preserving provider and tool settings", () => {
  const state = workspace();
  state.settings.userAvatar = "data:image/png;base64,eA==";
  state.settings.agentAvatar = "data:image/png;base64,eA==";
  state.settings.skins[0] = {
    ...state.settings.skins[0],
    backgroundImage: "data:image/png;base64,eA==",
  };
  const snapshot = structuredClone(state);
  const request = agentSettings(state.settings);
  assert.equal(JSON.stringify(request).includes("data:image/"), false);
  assert.deepEqual(request.skins, []);
  assert.deepEqual(request.providers, state.settings.providers);
  assert.deepEqual(request.search, state.settings.search);
  assert.equal(request.toolPermission, state.settings.toolPermission);
  assert.deepEqual(state, snapshot);
});
