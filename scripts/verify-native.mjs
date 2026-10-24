import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const nativeRequire = createRequire(import.meta.url);
const noWorkers = process.argv.includes("--no-workers");
let workerAttempts = 0;
if (noWorkers) {
  nativeRequire("node:worker_threads").Worker = class {
    constructor() {
      workerAttempts++;
      throw new Error(
        "Failed to construct 'Worker': The V8 platform used by this instance of Node does not support creating Workers",
      );
    }
  };
}

// An ESM entry has no global require, matching the host path that exposed the bug.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-host-"));
process.env.LUMEN_DATA_DIR = directory;
globalThis.window = new EventTarget();
let onEntry;
const calls = [];
let captureResult = "data:image/png;base64,aGVsbG8=";
globalThis.utools = {
  onPluginEnter(callback) {
    onEntry = callback;
  },
  onPluginOut() {},
  setExpandHeight() {},
  hideMainWindow() {
    calls.push("hide");
  },
  showMainWindow() {
    calls.push("show");
  },
  screenCapture: async () => {
    calls.push("capture");
    return captureResult;
  },
  copyImage(image) {
    assert.equal(image, captureResult);
    calls.push("copy");
  },
  showSaveDialog({ defaultPath }) {
    return path.join(directory, path.basename(defaultPath));
  },
};
try {
  await import(pathToFileURL(path.resolve("dist/preload.js")).href);
  assert.equal(window.lumenBootError, undefined, window.lumenBootError);
  assert.equal(typeof window.lumen?.load, "function");
  assert.equal(await window.lumen.load(), null);
  const snapshot = {
    settings: {
      providers: [],
      compact: true,
      sendKey: "ctrl-enter",
      toolPermission: "always_allow",
    },
    conversations: [],
    conversationGroups: [
      { id: "native-group", name: "Native", color: "#638ed5", collapsed: true },
    ],
    conversationOrder: [],
    ungroupedCollapsed: true,
  };
  await window.lumen.save(snapshot);
  assert.deepEqual(await window.lumen.load(), snapshot);
  await window.lumen.setToolPermission("always_allow");
  await window.lumen.setToolPermission("prompt");
  await assert.rejects(
    window.lumen.setToolPermission("invalid"),
    /权限模式无效/,
  );
  snapshot.settings.compact = false;
  await window.lumen.save(snapshot);
  const { LocalStore } = nativeRequire("../runtime/storage.cjs");
  assert.deepEqual(new LocalStore(directory).read("state"), snapshot);
  if (noWorkers) assert.equal(workerAttempts, 1);
  assert.ok(
    (await window.lumen.tools()).some((tool) => tool.name === "list_tools"),
  );
  const nativeTools = await window.lumen.tools();
  for (const name of [
    "get_current_conversation",
    "list_conversation_groups",
    "create_conversation_group",
    "move_conversation",
    "set_conversation_color",
    "rename_conversation",
  ])
    assert.ok(
      nativeTools.some((tool) => tool.name === name),
      name,
    );
  assert.equal(typeof window.lumen.conversationResult, "function");
  await window.lumen.conversationResult("expired-request", { success: true });
  const conversationCalls = [
    ["get_current_conversation", {}],
    ["list_conversation_groups", {}],
    ["create_conversation_group", { name: "Native tools" }],
    ["move_conversation", { groupId: "native-group" }],
    ["set_conversation_color", { color: "#638ed5" }],
    ["rename_conversation", { title: "Native renamed" }],
  ];
  const conversationRequests = [],
    commands = [],
    toolEvents = [];
  const nativeModel = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    conversationRequests.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message:
              conversationRequests.length === 1
                ? {
                    tool_calls: conversationCalls.map(
                      ([name, args], index) => ({
                        id: "native-" + index,
                        type: "function",
                        function: { name, arguments: JSON.stringify(args) },
                      }),
                    ),
                  }
                : { content: "Native conversation tools completed" },
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => nativeModel.listen(0, "127.0.0.1", resolve));
  try {
    await window.lumen.chat(
      {
        provider: {
          id: "native",
          name: "Native",
          protocol: "openai",
          baseURL: `http://127.0.0.1:${nativeModel.address().port}/v1`,
          keys: [],
        },
        model: "native",
        config: {},
        effort: "auto",
        messages: [],
        conversationId: "native-conversation",
        settings: {
          systemPrompt: "",
          customTools: [],
          disabledTools: [],
          search: { enabled: false },
          toolPermission: "always_allow",
        },
      },
      (event) => {
        if (event.type === "conversation-action") {
          commands.push(event.command);
          // Echoing commands tests the actual bundled request/ack boundary;
          // renderer mutation and persistence are exercised in conversations.test.cjs.
          void window.lumen.conversationResult(event.id, event.command);
        }
        if (event.type === "tool-result") toolEvents.push(event.call);
      },
    );
    assert.deepEqual(
      commands.map((command) => command.type),
      ["current", "groups", "group-create", "move", "color", "rename"],
    );
    assert.equal(commands[0].id, "native-conversation");
    assert.equal(commands[3].id, "native-conversation");
    assert.equal(commands[2].group.name, "Native tools");
    assert.equal(toolEvents.length, 6);
    assert.ok(toolEvents.every((call) => call.status === "done"));
    assert.equal(
      conversationRequests[1].messages.filter(
        (message) => message.role === "tool",
      ).length,
      6,
    );
  } finally {
    nativeModel.closeAllConnections();
    await new Promise((resolve) => nativeModel.close(resolve));
  }
  onEntry({ code: "translate", type: "over", payload: "Hello" });
  let received;
  window.lumen.onEnter((entry) => {
    received = entry;
  });
  assert.deepEqual(received, {
    code: "translate",
    type: "over",
    payload: "Hello",
  });
  assert.equal(await window.lumen.captureScreen(), captureResult);
  assert.deepEqual(calls.splice(0), ["hide", "capture", "copy", "show"]);
  captureResult = "";
  assert.equal(await window.lumen.captureScreen(), null);
  assert.deepEqual(calls.splice(0), ["hide", "capture", "show"]);
  utools.screenCapture = async () => {
    throw new Error("cancelled");
  };
  await assert.rejects(window.lumen.captureScreen(), /cancelled/);
  assert.deepEqual(calls, ["hide", "show"]);
  calls.splice(0);
  assert.deepEqual(await window.lumen.imageJobs(), []);
  assert.equal(typeof window.lumen.imageGenerate, "function");
  const imageId = "native-image-test";
  const imageData =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9kAAAAASUVORK5CYII=";
  captureResult = "data:image/png;base64," + imageData;
  const imageStore = new LocalStore(directory);
  await imageStore.write("image-" + imageId, { data: captureResult });
  assert.equal(await window.lumen.imageAsset(imageId), captureResult);
  await window.lumen.imageThumbnail(imageId, captureResult);
  assert.equal(await window.lumen.imageAsset(imageId, true), captureResult);
  await window.lumen.copyImage(imageId);
  assert.deepEqual(calls, ["copy"]);
  await window.lumen.saveImage(imageId);
  assert.deepEqual(
    fs.readFileSync(path.join(directory, `Lumen-${imageId}.png`)),
    Buffer.from(imageData, "base64"),
  );
  assert.equal((await window.lumen.usage()).records.length, 2);
  await window.lumen.exportFile("usage.csv", "input,output\n1,2");
  assert.equal(
    fs.readFileSync(path.join(directory, "usage.csv"), "utf8"),
    "input,output\n1,2",
  );
  console.log(
    `preload 检查通过（${noWorkers ? "Worker 不可用" : "Worker 可用"}）：存储、权限、六个会话工具与回执、快捷指令、截图、生图资产/缩略图、图片保存/复制、用量与 CSV`,
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
