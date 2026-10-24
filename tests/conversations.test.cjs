const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const { Core } = require("../runtime/core.cjs");
function bundle(file) {
  const compiled = new Module(
    path.join(__dirname, "conversation-bundle.cjs"),
    module,
  );
  compiled.filename = path.join(__dirname, "conversation-bundle.cjs");
  compiled._compile(
    buildSync({
      entryPoints: [path.join(__dirname, "../src/" + file)],
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
    }).outputFiles[0].text,
    compiled.filename,
  );
  return compiled.exports;
}
const { mergeState, importBackup, exportBackup } = bundle("state-data.ts");
const {
  applyConversationAction: apply,
  conversationCommand: command,
  orderedConversations: ordered,
} = bundle("conversation-data.ts");
const group = (id, extra = {}) => ({
  id,
  name: id,
  color: "#4d9d80",
  ...extra,
});
const chat = (id, extra = {}) => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  messages: [
    { id: "m-" + id, role: "user", content: "Keep " + id, createdAt: 1 },
  ],
  ...extra,
});
const workspace = () =>
  mergeState({
    conversationGroups: [group("work", { collapsed: true }), group("learn")],
    conversations: [
      chat("a", { groupId: "work", pinned: true }),
      chat("b", { groupId: "work" }),
      chat("c", { groupId: "learn" }),
      chat("d"),
    ],
    activeId: "a",
  });
const ids = (state, groupId) =>
  ordered(state)
    .filter((c) => groupId === undefined || c.groupId === groupId)
    .map((c) => c.id);
function coreFor(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "lumen-conversations-"),
  );
  const core = new Core({ directory });
  t.after(() => {
    core.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return core;
}

test("old state gains organization defaults; invalid groups, orphan references and stale order repair without data loss", () => {
  const old = { conversations: [chat("old")] };
  const state = mergeState(old);
  assert.deepEqual(state.conversationGroups, []);
  assert.deepEqual(state.conversationOrder, []);
  assert.deepEqual(
    state.conversations[0].messages,
    old.conversations[0].messages,
  );
  const broken = {
    conversationGroups: [
      group("valid"),
      group("valid"),
      group("bad", { color: "red" }),
    ],
    conversations: [
      chat("x", { groupId: "missing", color: "url(bad)", archived: "true" }),
      chat("y", { groupId: "valid", color: "#AABBCC", unread: true }),
    ],
    conversationOrder: ["x", "missing", "x", "y"],
    ungroupedCollapsed: true,
  };
  const snapshot = structuredClone(broken);
  const repaired = mergeState(broken);
  assert.equal(repaired.conversationGroups.length, 1);
  assert.equal(repaired.conversations[0].groupId, undefined);
  assert.equal(repaired.conversations[0].color, undefined);
  assert.equal(repaired.conversations[0].archived, false);
  assert.equal(repaired.conversations[1].groupId, "valid");
  assert.equal(repaired.conversations[1].unread, true);
  assert.deepEqual(repaired.conversationOrder, ["x", "y"]);
  assert.deepEqual(broken, snapshot);
});

test("create, edit, move and delete group preserve all messages and release members to ungrouped", () => {
  const original = workspace();
  let state = apply(original, {
    type: "group-create",
    group: group("ideas"),
    conversationId: "d",
  });
  state = apply(state, {
    type: "group-edit",
    id: "ideas",
    name: "Ideas",
    color: "#638ed5",
  });
  state = apply(state, { type: "move", id: "c", groupId: "work" });
  assert.equal(state.conversationGroups[0].collapsed, false);
  state = apply(state, { type: "group-delete", id: "work" });
  assert.equal(state.conversations.length, original.conversations.length);
  for (const c of state.conversations)
    assert.deepEqual(
      c.messages,
      original.conversations.find((x) => x.id === c.id).messages,
    );
  assert.equal(
    state.conversations.find((c) => c.id === "a").groupId,
    undefined,
  );
  assert.equal(state.conversations.find((c) => c.id === "a").pinned, true);
  assert.equal(state.conversations.find((c) => c.id === "d").groupId, "ideas");
  assert.equal(original.conversationGroups.length, 2);
});

test("invalid organization actions are atomic and duplicate group names are rejected", () => {
  const state = workspace(),
    snapshot = structuredClone(state);
  for (const action of [
    { type: "group-create", group: group("other", { name: " WORK " }) },
    { type: "group-edit", id: "learn", name: "WORK", color: "#112233" },
    { type: "group-create", group: group("invalid", { collapsed: "yes" }) },
    { type: "rename", id: "a", title: " " },
    { type: "rename", id: "a", title: "x".repeat(101) },
    { type: "color", id: "a", color: "var(--accent)" },
    { type: "move", id: "a", groupId: "missing" },
    { type: "move", id: "missing", groupId: "work" },
  ])
    assert.throws(() => apply(state, action));
  assert.deepEqual(state, snapshot);
});

test("manual row and group order persist; same-group pin crossing adopts zone, cross-group moves keep pinning", () => {
  let state = workspace();
  state = apply(state, {
    type: "reorder",
    id: "b",
    targetId: "a",
    after: false,
  });
  assert.deepEqual(ids(state, "work"), ["b", "a"]);
  assert.equal(state.conversations.find((c) => c.id === "b").pinned, true);
  state = apply(state, {
    type: "reorder",
    id: "a",
    targetId: "c",
    after: true,
  });
  assert.equal(state.conversations.find((c) => c.id === "a").groupId, "learn");
  assert.equal(state.conversations.find((c) => c.id === "a").pinned, true);
  state = apply(state, {
    type: "reorder",
    id: "d",
    targetId: "b",
    after: true,
  });
  assert.equal(state.conversations.find((c) => c.id === "d").pinned, undefined);
  state = apply(state, {
    type: "group-reorder",
    id: "learn",
    targetId: "work",
    after: false,
  });
  assert.deepEqual(
    state.conversationGroups.map((g) => g.id),
    ["learn", "work"],
  );
  assert.deepEqual(
    ids(mergeState(JSON.parse(JSON.stringify(state)))),
    ids(state),
  );
  const saved = ids(state);
  state.conversations = state.conversations.map((c) => ({
    ...c,
    updatedAt: c.id === "d" ? 99999 : 0,
  }));
  assert.deepEqual(ids(state), saved);
  state.conversations.push(chat("new", { updatedAt: 10 }));
  assert.equal(ids(state).filter((id) => !["a", "b"].includes(id))[0], "new");
});

test("archive, unread, collapse and deletion preserve their independent states and remove stale ordering", () => {
  let state = apply(workspace(), { type: "collapse-all", collapsed: true });
  assert.ok(state.conversationGroups.every((g) => g.collapsed));
  assert.equal(state.ungroupedCollapsed, true);
  state = apply(state, { type: "unread", id: "a", unread: true });
  state = apply(state, { type: "archive", id: "a", archived: true });
  assert.equal(state.activeId, undefined);
  assert.equal(state.conversations[0].unread, false);
  assert.equal(state.conversations[0].groupId, "work");
  assert.throws(
    () =>
      apply(state, { type: "reorder", id: "a", targetId: "b", after: true }),
    /同一个/,
  );
  state = apply(state, { type: "archive", id: "a", archived: false });
  state = apply(state, { type: "color", id: "a", color: "#AABBCC" });
  state = apply(state, { type: "color", id: "a" });
  assert.equal(state.conversations[0].color, undefined);
  state.conversationOrder = ["a", "b"];
  state = apply(state, { type: "delete", id: "a" });
  assert.deepEqual(state.conversationOrder, ["b"]);
  assert.equal(state.conversations.length, 3);
});

test("backup and encrypted storage retain groups, labels, order, unread and archived state", async (t) => {
  let state = apply(workspace(), {
    type: "reorder",
    id: "d",
    targetId: "b",
    after: false,
  });
  state = apply(state, { type: "color", id: "d", color: "#cc728e" });
  state = apply(state, { type: "unread", id: "b", unread: true });
  state = apply(state, { type: "archive", id: "c", archived: true });
  const restored = importBackup(
    JSON.parse(JSON.stringify(exportBackup(state, false))),
    mergeState(null),
  ).state;
  assert.deepEqual(restored.conversationGroups, state.conversationGroups);
  assert.deepEqual(restored.conversationOrder, state.conversationOrder);
  assert.deepEqual(
    JSON.parse(JSON.stringify(restored.conversations)),
    JSON.parse(JSON.stringify(state.conversations)),
  );
  const core = coreFor(t);
  await core.save(restored);
  const disk = mergeState(core.load());
  assert.deepEqual(
    JSON.parse(JSON.stringify(disk.conversations)),
    JSON.parse(JSON.stringify(state.conversations)),
  );
  assert.deepEqual(disk.conversationGroups, state.conversationGroups);
});

test("bad imports fail atomically, including excessive merged groups and built-in tool collisions", () => {
  const state = workspace(),
    snapshot = structuredClone(state);
  const bad = [
    { conversationGroups: [group("x"), group("x")] },
    { conversationGroups: [group("x", { collapsed: "false" })] },
    {
      conversationGroups: Array.from({ length: 199 }, (_, i) => group("g" + i)),
    },
    { conversations: [chat("x", { color: "#abc" })] },
    { conversations: [chat("x", { archived: 1 })] },
    { conversationOrder: [1] },
    { ungroupedCollapsed: "false" },
    {
      settings: {
        customTools: [
          {
            name: "rename_conversation",
            title: "Bad",
            description: "Bad",
            method: "POST",
            endpoint: "https://example.test/tool",
            inputSchema: { type: "object" },
          },
        ],
      },
    },
  ];
  for (const data of bad)
    assert.throws(() => importBackup({ providers: [], ...data }, state));
  assert.deepEqual(state, snapshot);
});

test("current conversation and group tools reveal only organization metadata", () => {
  const state = workspace();
  const current = command(state, { type: "current", id: "a" }).result;
  assert.deepEqual(
    Object.keys(current).sort(),
    [
      "id",
      "title",
      "groupId",
      "groupName",
      "color",
      "pinned",
      "archived",
    ].sort(),
  );
  assert.equal(current.id, "a");
  assert.equal(command(state, { type: "groups" }).result[0].count, 2);
  assert.equal(JSON.stringify(current).includes("Keep a"), false);
});

function call(name, args = {}, id = name) {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}
async function agent(t, turns, onEvent, overrides = {}) {
  const core = coreFor(t),
    requests = [],
    events = [];
  const mock = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.setHeader("Content-Type", "application/json");
    const calls =
      typeof turns === "function"
        ? turns(requests.length - 1, requests.at(-1))
        : turns[requests.length - 1];
    res.end(
      JSON.stringify({
        choices: [
          { message: calls ? { tool_calls: calls } : { content: "完成" } },
        ],
      }),
    );
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    mock.closeAllConnections();
    return new Promise((resolve) => mock.close(resolve));
  });
  await core.chat(
    {
      provider: {
        id: "qa",
        protocol: "openai",
        baseURL: `http://127.0.0.1:${mock.address().port}/v1`,
        keys: [],
      },
      model: "qa",
      config: {},
      messages: [{ role: "user", content: "整理当前会话" }],
      conversationId: "a",
      settings: {
        systemPrompt: "",
        search: { enabled: false },
        disabledTools: [],
        customTools: [],
        toolPermission: "always_allow",
        ...overrides.settings,
      },
      ...overrides.args,
    },
    (event) => {
      events.push(event);
      onEvent?.(event, core);
    },
  );
  return { core, requests, events };
}

test("Agent discovers and executes all six conversation tools, persists each change and stays bound after navigation", async (t) => {
  let state = workspace(),
    groupId,
    writes = 0;
  const { core, requests, events } = await agent(
    t,
    (round, request) => {
      if (round === 0) {
        const names = request.tools.map((tool) => tool.function.name);
        for (const name of [
          "get_current_conversation",
          "list_conversation_groups",
          "create_conversation_group",
          "move_conversation",
          "set_conversation_color",
          "rename_conversation",
        ])
          assert.ok(names.includes(name));
        return [
          call("get_current_conversation"),
          call("list_conversation_groups"),
        ];
      }
      if (round === 1)
        return [
          call("create_conversation_group", {
            name: "Agent group",
            color: "#638ed5",
          }),
        ];
      if (round === 2) {
        const result = JSON.parse(request.messages.at(-1).content);
        groupId = result.id;
        return [
          call("move_conversation", { conversationId: "a", groupId }),
          call("rename_conversation", { title: "Organized" }),
          call("set_conversation_color", { color: "#a086cf" }),
        ];
      }
      if (round === 3)
        return [call("get_current_conversation", {}, "current-after")];
    },
    (event, core) => {
      if (event.type !== "conversation-action") return;
      state = { ...state, activeId: "b" };
      const applied = command(state, event.command);
      if (applied.state === state)
        core.conversationResult(event.id, applied.result);
      else {
        state = applied.state;
        void core.save(state).then(
          () => {
            writes++;
            core.conversationResult(event.id, applied.result);
          },
          (error) =>
            core.conversationResult(event.id, undefined, error.message),
        );
      }
    },
  );
  assert.equal(writes, 4);
  const a = state.conversations.find((c) => c.id === "a"),
    b = state.conversations.find((c) => c.id === "b");
  assert.equal(a.title, "Organized");
  assert.equal(a.color, "#a086cf");
  assert.equal(a.groupId, groupId);
  assert.equal(b.title, "b");
  assert.equal(b.groupId, "work");
  assert.equal(state.activeId, "b");
  assert.deepEqual(
    core.load().conversations,
    JSON.parse(JSON.stringify(state.conversations)),
  );
  const result = JSON.parse(requests.at(-1).messages.at(-1).content);
  assert.equal(result.id, "a");
  assert.equal(result.title, "Organized");
  assert.equal(
    events.filter((e) => e.type === "tool-result" && e.call.status === "error")
      .length,
    0,
  );
  assert.equal(core.conversationActions.size, 0);
});

test("denied, disabled, cross-conversation and invalid calls cannot reach the renderer", async (t) => {
  const { events, requests } = await agent(
    t,
    [
      [
        call("rename_conversation", { title: "Denied" }),
        call("move_conversation", { groupId: "work" }),
        call("set_conversation_color", {
          conversationId: "b",
          color: "#112233",
        }),
        call("rename_conversation", { title: 17 }, "invalid"),
      ],
    ],
    (event, core) => {
      if (event.type === "approval")
        core.approve(event.id, event.name === "set_conversation_color");
    },
    {
      settings: {
        toolPermission: "prompt",
        disabledTools: ["move_conversation"],
      },
    },
  );
  assert.equal(
    events.filter((e) => e.type === "conversation-action").length,
    0,
  );
  const results = requests[1].messages
    .filter((m) => m.role === "tool")
    .map((m) => JSON.parse(m.content));
  assert.equal(results[0].denied, true);
  assert.match(results[1].error, /已关闭/);
  assert.match(results[2].error, /只能管理/);
  assert.match(results[3].error, /类型错误/);
});

test("missing conversation context and persistence failure return truthful tool errors", async (t) => {
  const missing = await agent(t, [[call("get_current_conversation")]], null, {
    args: { conversationId: undefined },
  });
  assert.equal(
    missing.events.filter((e) => e.type === "conversation-action").length,
    0,
  );
  assert.match(
    missing.events.find((e) => e.type === "tool-result").call.result.error,
    /缺少当前会话/,
  );
  const failed = await agent(
    t,
    [[call("rename_conversation", { title: "unsaved" })]],
    (event, core) => {
      if (event.type === "conversation-action")
        core.conversationResult(event.id, undefined, "保存失败");
    },
  );
  assert.match(
    failed.events.find((e) => e.type === "tool-result").call.result.error,
    /保存失败/,
  );
  assert.equal(failed.core.conversationActions.size, 0);
});

test("stopping while awaiting the renderer releases locks and ignores late acknowledgements", async (t) => {
  let pending;
  const { core, events } = await agent(
    t,
    [[call("get_current_conversation")]],
    (event, core) => {
      if (event.type === "conversation-action") {
        pending = event.id;
        core.stop();
      }
    },
  );
  assert.equal(core.conversationActions.size, 0);
  assert.equal(core.controller, null);
  core.conversationResult(pending, { id: "a" });
  assert.ok(events.some((e) => e.type === "done" && e.text === "stopped"));
});

test("renderer exceptions and timeout clean pending commands instead of leaving a stuck chat", async (t) => {
  const core = coreFor(t);
  await assert.rejects(
    core.requestConversationAction(
      { type: "groups" },
      () => {
        throw new Error("renderer closed");
      },
      new AbortController().signal,
    ),
    /renderer closed/,
  );
  assert.equal(core.conversationActions.size, 0);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = core.requestConversationAction(
    { type: "groups" },
    () => {},
    new AbortController().signal,
  );
  const rejected = assert.rejects(pending, /未及时响应/);
  t.mock.timers.tick(30001);
  await rejected;
  assert.equal(core.conversationActions.size, 0);
});
