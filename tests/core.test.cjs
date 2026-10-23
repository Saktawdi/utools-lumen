const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const Module = require("node:module");
const { Readable } = require("node:stream");
const { sse } = require("../runtime/transport.cjs");
const { buildRequest, createCollector } = require("../runtime/adapters.cjs");
const { withKeys, webSearch } = require("../runtime/search.cjs");
const { builtins, addCustom, calculate } = require("../runtime/tools.cjs");
const { LocalStore } = require("../runtime/storage.cjs");
const { Core, cleanError } = require("../runtime/core.cjs");
const { matchModel, flattenCatalog } = require("../runtime/catalog.cjs");

test("nonstream Chat responses preserve multiple tool calls without collapsing indexes", () => {
  const collector = createCollector("openai", () => {});
  collector.push({
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: "a",
              function: {
                name: "calculate",
                arguments: '{"expression":"1+1"}',
              },
            },
            { id: "b", function: { name: "current_time", arguments: "{}" } },
          ],
        },
      },
    ],
  });
  assert.deepEqual(
    collector.result().calls.map((c) => c.id),
    ["a", "b"],
  );
});
const provider = {
  id: "unit",
  protocol: "openai",
  baseURL: "http://localhost/v1",
  keys: ["a", "b"],
  headers: {},
};
const settings = {
  systemPrompt: "A helpful assistant.",
  disabledTools: [],
  customTools: [],
  search: { enabled: false },
};
async function server(t, handler) {
  const s = http.createServer(handler);
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  t.after(() => s.closeAllConnections());
  t.after(() => new Promise((r) => s.close(r)));
  return `http://127.0.0.1:${s.address().port}`;
}
async function json(req) {
  let value = "";
  for await (const c of req) value += c;
  return JSON.parse(value || "{}");
}
function temporary(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-test-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

test("registry failure releases the request lock and developer registrations validate immediately", async (t) => {
  const core = new Core({ directory: temporary(t) });
  assert.throws(() =>
    core.registerTool({
      name: "calculate",
      inputSchema: { type: "object" },
      execute() {},
    }),
  );
  const broken = {
    ...settings,
    customTools: [
      {
        name: "calculate",
        inputSchema: { type: "object" },
        endpoint: "https://invalid.test",
        method: "POST",
      },
    ],
  };
  await assert.rejects(
    core.chat(
      { provider, model: "x", config: {}, settings: broken, messages: [] },
      () => {},
    ),
    /已存在/,
  );
  assert.equal(core.controller, null);
});

test("model listing and search errors redact custom authentication values", async (t) => {
  const url = await server(t, (req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: { message: "bad header-secret and search-secret" },
      }),
    );
  });
  const core = new Core({ directory: temporary(t) });
  await assert.rejects(
    core.models({
      ...provider,
      baseURL: url,
      headers: { "X-Private": "header-secret" },
    }),
    (error) => !error.message.includes("header-secret"),
  );
  await assert.rejects(
    core.searchTest(
      { engine: "custom", endpoint: url, keys: ["search-secret"] },
      "test",
    ),
    (error) => !error.message.includes("search-secret"),
  );
});
test("SSE handles CRLF, chunked UTF-8, comments, multiple data lines and final event", async () => {
  const input = Buffer.from(
    ': ping\r\nevent: message\r\ndata: {"text":\r\ndata: "你好 🌿"}\r\n\r\ndata: [DONE]\n\ndata: {"ok":true}',
  );
  const bytes = [...input].map((x) => Buffer.from([x]));
  const events = [];
  for await (const e of sse(Readable.from(bytes))) events.push(e);
  assert.deepEqual(events, [
    { event: "message", data: { text: "你好 🌿" } },
    { event: undefined, data: { ok: true } },
  ]);
});
test("key pools rotate each request, fail over once per key and propagate cancellation", async () => {
  const used = [];
  await withKeys("rotation-test", ["one", "two"], async (k) => used.push(k));
  await withKeys("rotation-test", ["one", "two"], async (k) => used.push(k));
  assert.deepEqual(used, ["one", "two"]);
  const seen = [];
  assert.equal(
    await withKeys("failover-test", ["bad", "good"], async (k) => {
      seen.push(k);
      if (k === "bad") throw Object.assign(new Error("rate"), { status: 429 });
      return k;
    }),
    "good",
  );
  assert.deepEqual(seen, ["bad", "good"]);
  let count = 0;
  await assert.rejects(
    withKeys("abort", ["a", "b"], async () => {
      count++;
      throw Object.assign(new Error("stop"), { name: "AbortError" });
    }),
  );
  assert.equal(count, 1);
});
test("reasoning auto is omitted; explicit protocol settings and native image payloads are correct", () => {
  const messages = [
    { role: "system", content: "s" },
    { role: "user", content: "look", images: ["data:image/png;base64,YWJj"] },
  ];
  const chat = buildRequest(provider, "gpt-6-luna", messages, [], "auto", {});
  assert.equal("reasoning_effort" in chat.body, false);
  assert.equal(chat.body.max_completion_tokens, 8192);
  assert.equal(
    chat.body.messages[1].content[1].image_url.url,
    messages[1].images[0],
  );
  const deepseek = buildRequest(
    provider,
    "deepseek-chat",
    messages,
    [],
    "none",
    { reasoningMode: "toggle" },
  );
  assert.equal(deepseek.body.enable_thinking, false);
  assert.equal(deepseek.body.max_tokens, 8192);
  const responses = buildRequest(
    { ...provider, protocol: "responses" },
    "test",
    messages,
    [],
    "high",
    {},
  );
  assert.deepEqual(responses.body.reasoning, { effort: "high" });
  assert.equal(responses.body.input[1].content[1].type, "input_image");
  const anth = buildRequest(
    { ...provider, protocol: "anthropic" },
    "claude-sonnet-4-5",
    messages,
    [],
    "high",
    {},
  );
  assert.equal(anth.body.thinking.type, "enabled");
  assert.equal(anth.body.messages[0].content[1].source.media_type, "image/png");
  const gem = buildRequest(
    { ...provider, protocol: "google" },
    "gemini-2.5-pro",
    messages,
    [],
    "high",
    {},
  );
  assert.equal(gem.body.generationConfig.thinkingConfig.thinkingBudget, 8192);
});
test("native reasoning signatures survive tool continuation for Anthropic, Google and Responses", () => {
  const anth = createCollector("anthropic", () => {});
  anth.push({
    type: "content_block_start",
    index: 0,
    content_block: { type: "thinking", thinking: "", signature: "" },
  });
  anth.push({
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "summary" },
  });
  anth.push({
    type: "content_block_delta",
    index: 0,
    delta: { type: "signature_delta", signature: "signed" },
  });
  anth.push({
    type: "content_block_start",
    index: 1,
    content_block: {
      type: "tool_use",
      id: "call-a",
      name: "calculate",
      input: {},
    },
  });
  anth.push({
    type: "content_block_delta",
    index: 1,
    delta: { type: "input_json_delta", partial_json: '{"expression":"2+2"}' },
  });
  const a = anth.result();
  const request = buildRequest(
    { ...provider, protocol: "anthropic" },
    "claude-sonnet-4-5",
    [
      {
        role: "assistant",
        content: "",
        tool_calls: a.calls,
        nativeAnthropic: a.nativeAnthropic,
      },
    ],
    [],
    "auto",
    {},
  );
  assert.equal(request.body.messages[0].content[0].signature, "signed");
  assert.deepEqual(request.body.messages[0].content[1].input, {
    expression: "2+2",
  });
  const gem = createCollector("google", () => {});
  gem.push({
    candidates: [
      {
        content: {
          parts: [
            {
              functionCall: { name: "calculate", args: { expression: "2+2" } },
              thoughtSignature: "gem-signed",
            },
          ],
        },
      },
    ],
  });
  const g = gem.result();
  assert.equal(
    buildRequest(
      { ...provider, protocol: "google" },
      "gemini-3",
      [{ role: "assistant", nativeGoogle: g.nativeGoogle }],
      [],
      "auto",
      {},
    ).body.contents[0].parts[0].thoughtSignature,
    "gem-signed",
  );
  const resp = createCollector("responses", () => {});
  resp.push({
    type: "response.output_item.done",
    output_index: 0,
    item: { type: "reasoning", encrypted_content: "encrypted", summary: [] },
  });
  assert.equal(
    buildRequest(
      { ...provider, protocol: "responses" },
      "test",
      [{ role: "assistant", nativeResponses: resp.result().nativeResponses }],
      [],
      "auto",
      {},
    ).body.input[0].encrypted_content,
    "encrypted",
  );
});
test("model catalog matches normalized IDs without substring guesses and respects capabilities", () => {
  const entries = flattenCatalog({
    a: {
      models: {
        "vendor/Test-1.2": {
          id: "vendor/Test-1.2",
          reasoning: true,
          tool_call: true,
          modalities: { input: ["image", "text"] },
          limit: { context: 128000 },
          reasoning_options: [{ type: "effort", values: ["low", "high"] }],
        },
      },
    },
  });
  const found = matchModel("test-1-2", entries);
  assert.equal(found.vision, true);
  assert.deepEqual(found.levels, ["low", "high"]);
  assert.equal(matchModel("test-1", entries), null);
});
test("tool registry discovers registered tools, enforces switches, validation and approvals without exposing secrets", async () => {
  const registry = builtins();
  const context = { settings, attachments: [], approve: async () => false };
  assert.equal(calculate("(128+256)*3"), 1152);
  assert.throws(() => calculate("process.exit()"));
  assert.throws(() => calculate("1/0"));
  addCustom(registry, {
    name: "echo",
    title: "Echo",
    description: "Echo",
    group: "Test",
    method: "POST",
    endpoint: "http://localhost",
    headers: { Authorization: "secret" },
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  });
  const listed = await registry.execute("list_tools", {}, context);
  assert.equal(listed.find((t) => t.name === "echo").headers, undefined);
  assert.equal(
    (await registry.execute("echo", { query: "hi" }, context)).denied,
    true,
  );
  await assert.rejects(
    registry.execute("calculate", { expression: 5 }, context),
    /类型/,
  );
  await assert.rejects(
    registry.execute(
      "calculate",
      { expression: "2+2" },
      { ...context, settings: { ...settings, disabledTools: ["calculate"] } },
    ),
    /关闭/,
  );
});
test("encrypted atomic store roundtrips secrets and chat state without plaintext on disk", async (t) => {
  const folder = temporary(t),
    store = new LocalStore(folder);
  const value = {
    settings: { apiKey: "test-secret-123" },
    conversations: [{ content: "私密聊天" }],
  };
  await Promise.all([
    store.write("state", value),
    store.write("state", { ...value, version: 2 }),
  ]);
  const buffer = fs.readFileSync(path.join(folder, "state.enc"));
  assert.equal(buffer.includes(Buffer.from("test-secret-123")), false);
  assert.equal(buffer.includes(Buffer.from("私密聊天")), false);
  assert.equal(new LocalStore(folder).read("state").version, 2);
  const tampered = Buffer.from(buffer);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => store.decode(tampered));
});

test("background saves preserve old data, capture snapshots, and recover after a failed queued save", async (t) => {
  const folder = temporary(t);
  const store = new LocalStore(folder);
  const file = path.join(folder, "state.enc");
  fs.writeFileSync(file, store.encode({ version: 1, text: "已有数据" }));
  assert.equal(store.read("state").version, 1);

  const snapshot = { version: 2, text: "保存时的内容" };
  const first = store.write("state", snapshot);
  snapshot.text = "调用后的修改";
  const invalid = store.write("state", { unsupported: 1n });
  const last = store.write("state", { version: 3, text: "最终内容" });
  const results = await Promise.allSettled([first, invalid, last]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "rejected", "fulfilled"],
  );
  assert.deepEqual(store.read("state"), { version: 3, text: "最终内容" });
  assert.deepEqual(store.decode(fs.readFileSync(file + ".bak")), {
    version: 2,
    text: "保存时的内容",
  });
});
test("embedded hosts without Workers still persist preferences, preserve snapshots and recover from disk failures", async (t) => {
  const folder = temporary(t);
  const filename = path.join(__dirname, "../runtime/storage.cjs");
  const hostModule = new Module(filename, module);
  hostModule.filename = filename;
  let attempts = 0;
  hostModule.require = (id) =>
    id === "node:worker_threads"
      ? {
          Worker: class {
            constructor() {
              attempts++;
              throw new Error(
                "Failed to construct 'Worker': The V8 platform used by this instance of Node does not support creating Workers",
              );
            }
          },
        }
      : require(id);
  hostModule._compile(fs.readFileSync(filename, "utf8"), filename);
  const store = new hostModule.exports.LocalStore(folder);
  const value = {
    settings: {
      sendKey: "ctrl-enter",
      compact: true,
      apiKey: "fallback-secret",
    },
    conversations: [{ content: "原有对话" }],
  };
  const first = store.write("state", value);
  value.settings.compact = false;
  const invalid = store.write("state", { unsupported: 1n });
  const last = store.write("state", { ...value, version: 2 });
  const results = await Promise.allSettled([first, invalid, last]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "rejected", "fulfilled"],
  );
  assert.equal(attempts, 1, "unsupported Worker is only tried once");
  const file = path.join(folder, "state.enc");
  assert.equal(
    fs.readFileSync(file).includes(Buffer.from("fallback-secret")),
    false,
  );
  assert.equal(
    store.decode(fs.readFileSync(file + ".bak")).settings.compact,
    true,
  );
  assert.deepEqual(new LocalStore(folder).read("state"), {
    ...value,
    version: 2,
  });

  fs.mkdirSync(file + ".tmp");
  await assert.rejects(store.write("state", { version: 3 }));
  assert.equal(
    store.read("state").version,
    2,
    "failed writes preserve the saved file",
  );
  fs.rmdirSync(file + ".tmp");
  await store.write("state", { ...value, version: 4 });
  assert.equal(new LocalStore(folder).read("state").version, 4);
  assert.equal(attempts, 1);
});

async function permissionAgent(t, toolPermission, onEvent, overrides = {}) {
  const executed = [];
  const requests = [];
  const url = await server(t, async (req, res) => {
    requests.push(await json(req));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message:
              requests.length === 1
                ? {
                    tool_calls: ["first", "second"].map((value, index) => ({
                      id: "guard-" + index,
                      type: "function",
                      function: {
                        name: "guarded",
                        arguments: JSON.stringify({ value }),
                      },
                    })),
                  }
                : { content: "已完成" },
          },
        ],
      }),
    );
  });
  const core = new Core({ directory: temporary(t) });
  t.after(() => core.stop());
  core.registerTool({
    name: "guarded",
    title: "Guarded",
    description: "A tool requiring approval",
    group: "Test",
    approval: true,
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
    execute: ({ value }) => {
      executed.push(value);
      return value;
    },
  });
  const events = [];
  await core.chat(
    {
      provider: { ...provider, baseURL: url + "/v1" },
      model: "test",
      config: {},
      messages: [],
      settings: { ...settings, toolPermission, ...overrides },
    },
    (event) => {
      events.push(event);
      onEvent?.(event, core, executed);
    },
  );
  return { core, events, executed, requests };
}
test("prompt mode asks separately for each protected call; deny never executes it", async (t) => {
  let prompts = 0;
  const { executed, requests, events } = await permissionAgent(
    t,
    undefined,
    (event, core, calls) => {
      if (event.type !== "approval") return;
      assert.equal(calls.length, prompts === 0 ? 0 : 1);
      core.approve(event.id, prompts++ === 0);
    },
  );
  assert.equal(prompts, 2);
  assert.deepEqual(executed, ["first"]);
  const results = requests[1].messages.filter(
    (message) => message.role === "tool",
  );
  assert.equal(JSON.parse(results[1].content).denied, true);
  assert.equal(
    events.filter((event) => event.type === "approval-resolved").length,
    2,
  );
});
test("Auto allows protected calls and switching to prompt applies to the next call in the same response", async (t) => {
  let prompts = 0;
  const { executed } = await permissionAgent(
    t,
    "always_allow",
    (event, core, calls) => {
      if (event.type === "tool-result" && calls.length === 1)
        core.setToolPermission("prompt");
      if (event.type === "approval") {
        prompts++;
        assert.equal(calls.length, 1);
        core.approve(event.id, false);
      }
    },
  );
  assert.equal(prompts, 1);
  assert.deepEqual(executed, ["first"]);
});
test("switching a pending approval to Auto releases it and subsequent calls without another prompt", async (t) => {
  let prompts = 0;
  const { executed, core, events } = await permissionAgent(
    t,
    "prompt",
    (event, core, calls) => {
      if (event.type !== "approval") return;
      assert.equal(calls.length, 0);
      prompts++;
      core.setToolPermission("always_allow");
    },
  );
  assert.equal(prompts, 1);
  assert.deepEqual(executed, ["first", "second"]);
  assert.equal(core.approvals.size, 0);
  assert.equal(
    events.filter((event) => event.type === "approval-resolved").length,
    1,
  );
});
test("stopping a pending approval cannot be undone by a late Auto switch or approval", async (t) => {
  const { executed, core, events } = await permissionAgent(
    t,
    "prompt",
    (event, core) => {
      if (event.type !== "approval") return;
      core.stop();
      core.setToolPermission("always_allow");
      core.approve(event.id, true);
    },
  );
  assert.deepEqual(executed, []);
  assert.equal(core.controller, null);
  assert.equal(core.approvals.size, 0);
  assert.ok(
    events.some((event) => event.type === "done" && event.text === "stopped"),
  );
});
test("Auto keeps disabled tools blocked and rejects invalid permission modes", async (t) => {
  const { executed, events, core } = await permissionAgent(
    t,
    "always_allow",
    null,
    { disabledTools: ["guarded"] },
  );
  assert.deepEqual(executed, []);
  assert.equal(
    events.filter(
      (event) => event.type === "tool-result" && event.call.status === "error",
    ).length,
    2,
  );
  assert.throws(() => core.setToolPermission("anything"), /权限模式无效/);
});
test("agent loop executes real tools, sends tool results upstream and accumulates stream text", async (t) => {
  let turn = 0;
  const received = [];
  const url = await server(t, async (req, res) => {
    const body = await json(req);
    received.push(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (turn++ === 0) {
      res.end(
        "data: " +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call1",
                      function: {
                        name: "calculate",
                        arguments: '{"expression":"4*7"}',
                      },
                    },
                  ],
                },
              },
            ],
          }) +
          "\n\n",
      );
    } else
      res.end(
        "data: " +
          JSON.stringify({
            choices: [{ delta: { content: "答案是 28。" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }) +
          "\n\ndata: [DONE]\n\n",
      );
  });
  const core = new Core({ directory: temporary(t) });
  const events = [];
  await core.chat(
    {
      provider: { ...provider, baseURL: url + "/v1" },
      model: "test",
      config: {},
      effort: "auto",
      messages: [{ role: "user", content: "4*7" }],
      settings,
    },
    (e) => events.push(e),
  );
  assert.equal(received.length, 2);
  assert.equal(received[1].messages.at(-1).role, "tool");
  assert.match(received[1].messages.at(-1).content, /'?28'?/);
  assert.equal(events.find((e) => e.type === "text").text, "答案是 28。");
  assert.equal(
    events.find((e) => e.type === "tool-result").call.status,
    "done",
  );
  assert.equal(core.controller, null);
});
test("AnySearch MCP initializes, calls documented search tool, and rotates multiple imported keys", async (t) => {
  const calls = [];
  const url = await server(t, async (req, res) => {
    const body = await json(req);
    calls.push({ body, key: req.headers.authorization });
    res.writeHead(body.id ? 200 : 202, {
      "Content-Type": "application/json",
      "Mcp-Session-Id": "session1",
    });
    if (body.method === "initialize")
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { protocolVersion: "2025-03-26" },
        }),
      );
    else if (!body.id) res.end();
    else
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: { content: [{ type: "text", text: "search-result" }] },
        }),
      );
  });
  const config = {
    engine: "anysearch",
    endpoint: url + "/mcp",
    keyMode: "bearer",
    keys: ["first", "second"],
    limit: 3,
  };
  assert.equal((await webSearch(config, "hello")).content, "search-result");
  await webSearch(config, "again");
  assert.equal(calls[2].body.params.name, "search");
  assert.deepEqual(calls[2].body.params.arguments, {
    query: "hello",
    max_results: 3,
  });
  assert.equal(calls[0].key, "Bearer first");
  assert.equal(calls[3].key, "Bearer second");
});
test("API errors are redacted and models with tool support disabled do not receive tool definitions", () => {
  assert.equal(
    cleanError(new Error("bad abc-123"), {
      providers: [{ keys: ["abc-123"] }],
    }),
    "bad [密钥已隐藏]",
  );
  const request = buildRequest(provider, "model", [], [], "auto", {});
  assert.equal("tools" in request.body, false);
});
