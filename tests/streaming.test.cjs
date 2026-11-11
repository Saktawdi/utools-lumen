const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");
function compile(file, dependencies = {}, external = []) {
  const filename = path.join(__dirname, "streaming-bundle.cjs");
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.require = (id) =>
    Object.hasOwn(dependencies, id) ? dependencies[id] : require(id);
  compiled._compile(
    buildSync({
      entryPoints: [path.join(__dirname, "../src/" + file)],
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      external,
      loader: { ".css": "empty" },
      logLevel: "silent",
    }).outputFiles[0].text,
    filename,
  );
  return compiled.exports;
}
const { mergeState } = compile("state-data.ts");
const { AttachmentIngress, imageFingerprint } = compile(
  "attachment-ingress.ts",
);
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 60));
function appHarness(t, capture = async () => "data:image/png;base64,aW1hZ2U=") {
  const previousWindow = global.window;
  global.window = new EventTarget();
  t.after(() => {
    global.window = previousWindow;
  });
  const provider = {
    id: "p",
    name: "Mock",
    enabled: true,
    models: ["m"],
    availableModels: [],
    protocol: "openai",
    baseURL: "http://localhost",
    keys: [],
    modelConfigs: {},
  };
  const initial = mergeState({
    settings: { providers: [provider] },
    activeId: "a",
    conversations: ["a", "b"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    })),
  });
  const pending = new Map(),
    saves = [],
    stopped = [],
    screenshots = [],
    timers = [];
  const bridge = {
    chat: (args, event) => {
      const gate = deferred();
      pending.set(args.conversationId, { args, event, ...gate });
      return gate.promise;
    },
    save: async (state) => {
      saves.push(structuredClone(state));
    },
    stop: (id) => {
      stopped.push(id);
    },
    approve: () => {},
    setToolPermission: async () => {},
    captureScreen: async (options) => {
      screenshots.push(options);
      return capture(options);
    },
  };
  const slots = [];
  let cursor = 0,
    stateCalls = 0;
  const hooks = {
    lazy: () => function Studio() {},
    Suspense: function Suspense() {},
    useState: (value) => {
      const index = cursor++;
      if (!(index in slots)) {
        slots[index] =
          stateCalls === 0
            ? initial
            : stateCalls === 1
              ? true
              : typeof value === "function"
                ? value()
                : value;
      }
      stateCalls++;
      return [
        slots[index],
        (next) => {
          slots[index] = typeof next === "function" ? next(slots[index]) : next;
        },
      ];
    },
    useRef: (value) => {
      const index = cursor++;
      return (slots[index] ||= { current: value });
    },
    useMemo: (fn) => {
      cursor++;
      return fn();
    },
    useCallback: (fn) => {
      cursor++;
      return fn;
    },
    useEffect: () => {
      cursor++;
    },
  };
  const element = (type, props, key) => ({ type, props: props || {}, key });
  const named = (name) =>
    Object.defineProperty(() => null, "name", { value: name });
  const chatUI = Object.fromEntries(
    ["ApprovalCard", "Composer", "MessageView", "ToolsPopover", "Welcome"].map(
      (name) => [name, named(name)],
    ),
  );
  const icon = named("Icon");
  const App = compile(
    "App.tsx",
    {
      react: hooks,
      "react/jsx-runtime": {
        jsx: element,
        jsxs: element,
        Fragment: "fragment",
      },
      "lucide-react": new Proxy({}, { get: () => icon }),
      "./bridge": { bridge, mergeState },
      "./ChatUI": chatUI,
      "./ConversationList": named("ConversationList"),
      "./Settings": named("Settings"),
    },
    [
      "react",
      "react/jsx-runtime",
      "lucide-react",
      "./bridge",
      "./ChatUI",
      "./ConversationList",
      "./Settings",
    ],
  ).default;
  // Effects are deliberately not executed: this exercises App's real callbacks,
  // closures and state updates independently from DOM presentation and load I/O.
  const nativeTimeout = global.setTimeout;
  t.mock.method(global, "setTimeout", (...args) => {
    const timer = nativeTimeout(...args);
    timers.push(timer);
    return timer;
  });
  t.after(() => {
    for (const timer of timers) clearTimeout(timer);
  });
  const find = (node, name) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = find(child, name);
        if (found) return found;
      }
      return;
    }
    if (node.type?.name === name) return node.props;
    return find(node.props?.children, name);
  };
  const render = () => {
    cursor = 0;
    stateCalls = 0;
    const tree = App();
    return {
      composer: find(tree, "Composer"),
      list: find(tree, "ConversationList"),
      approval: find(tree, "ApprovalCard"),
      state: slots[0],
      tree,
    };
  };
  const enter = (entry) =>
    slots.find((slot) => typeof slot?.current === "function").current(entry);
  return { render, pending, saves, stopped, screenshots, enter };
}
test("App sends across conversations, isolates live state and persists tool-limit context", async (t) => {
  const h = appHarness(t);
  h.render().composer.setDraft("first");
  h.render().composer.onSend();
  assert.ok(h.pending.has("a"));
  assert.equal(h.render().composer.busy, true);
  assert.equal(h.render().list.onAction({ type: "delete", id: "a" }), false);
  h.render().list.onSelect("b");
  assert.equal(h.render().composer.busy, false);
  h.render().composer.setDraft("second");
  h.render().composer.onSend();
  assert.equal(h.pending.size, 2);
  assert.deepEqual([...h.render().list.runningIds].sort(), ["a", "b"]);
  const a = h.pending.get("a"),
    b = h.pending.get("b");
  const context = [
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "tool-a", name: "calculate", arguments: "{}" }],
    },
    {
      role: "tool",
      content: "42",
      tool_call_id: "tool-a",
      tool_name: "calculate",
    },
  ];
  a.event({ type: "text", text: "answer-a" });
  a.event({ type: "context", context });
  a.event({ type: "approval", id: "approval-a", name: "tool" });
  b.event({ type: "text", text: "answer-b" });
  b.event({ type: "approval", id: "approval-b", name: "tool" });
  await tick();
  assert.deepEqual([...h.render().list.waitingIds].sort(), ["a", "b"]);
  assert.equal(h.render().approval.event.id, "approval-b");
  a.event({ type: "done", reason: "tool-limit", limit: 1 });
  a.resolve();
  await tick();
  const live = h.render();
  assert.equal(
    live.state.activeId,
    "b",
    "background completion must not navigate",
  );
  assert.equal(live.composer.busy, true);
  assert.deepEqual([...live.list.runningIds], ["b"]);
  assert.equal(live.approval.event.id, "approval-b");
  const saved = h.saves.at(-1);
  assert.equal(
    saved.conversations.find((c) => c.id === "b").messages.at(-1).content,
    "answer-b",
  );
  const replyA = saved.conversations.find((c) => c.id === "a").messages.at(-1);
  assert.deepEqual(replyA.agentContext, context);
  assert.equal(replyA.toolLimit, 1);
  assert.equal(replyA.error, undefined);
  live.composer.onStop();
  assert.deepEqual(h.stopped, ["b"]);
  b.event({ type: "done", text: "stopped" });
  b.resolve();
  await tick();
  h.render().list.onSelect("a");
  h.render().composer.setDraft("continue");
  h.render().composer.onSend();
  const next = h.pending.get("a");
  assert.deepEqual(next.args.messages[1].agentContext, context);
  next.event({ type: "done" });
  next.resolve();
  await tick();
  assert.equal(h.render().composer.busy, false);
});
function decodedImages(t, images) {
  const previousImage = global.Image,
    previousDocument = global.document;
  const canvases = [];
  global.Image = class {
    async decode() {
      const pixels = images.get(this.src);
      if (!pixels) throw new Error("unsupported image");
      this.naturalWidth = 1;
      this.naturalHeight = 1;
      this.pixels = pixels;
    }
  };
  global.document = {
    createElement: (name) => {
      assert.equal(name, "canvas");
      let drawn;
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: (image) => {
            drawn = image;
          },
          getImageData: () => ({ data: new Uint8ClampedArray(drawn.pixels) }),
        }),
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  t.after(() => {
    global.Image = previousImage;
    global.document = previousDocument;
  });
  return canvases;
}
test("pixel fingerprints recognize different encodings and release decoded resources", async (t) => {
  const a = "data:image/png;base64,ZW5jb2RlZC1h";
  const b = "data:image/png;base64,ZW5jb2RlZC1iLXdpdGgtbWV0YWRhdGE=";
  const c = "data:image/png;base64,b3RoZXI=";
  const canvases = decodedImages(
    t,
    new Map([
      [a, [20, 40, 60, 255]],
      [b, [20, 40, 60, 255]],
      [c, [21, 40, 60, 255]],
    ]),
  );
  assert.equal(await imageFingerprint(a), await imageFingerprint(b));
  assert.notEqual(await imageFingerprint(a), await imageFingerprint(c));
  assert.ok(
    canvases.every((canvas) => canvas.width === 0 && canvas.height === 0),
  );
  assert.equal(
    await imageFingerprint("invalid"),
    "data:invalid",
    "invalid image must not be guessed equivalent",
  );
});
test("cross-source pairing accepts intentional repeated pastes, picks and later same-image entries", async () => {
  let current = [];
  const ingress = new AttachmentIngress(async (data) =>
    data === "host-encoding" || data === "paste-encoding"
      ? "same-pixels"
      : data,
  );
  const item = (id, data = "host-encoding") => ({
    id,
    name: id + ".png",
    mime: "image/png",
    type: "image",
    data,
    size: 10,
  });
  const receive = (id, source, at, data) =>
    ingress.receive(
      [item(id, data)],
      source,
      at,
      () => current,
      (next) => {
        current = next;
      },
    );
  await receive("host-1", "host", 1000);
  await receive("paste-1", "paste", 1001, "paste-encoding");
  assert.equal(current.length, 1);
  await receive("paste-2", "paste", 1002, "paste-encoding");
  assert.equal(current.length, 2, "second intentional paste is not an echo");
  await receive("host-2", "host", 1003);
  assert.equal(current.length, 2, "host echo pairs with the second paste");
  await receive("pick", "file", 1004);
  assert.equal(
    current.length,
    3,
    "explicit file selection remains intentional",
  );
  await receive("later-host", "host", 3000);
  assert.equal(
    current.length,
    4,
    "a later input cannot match a stale operation",
  );
});
test("serialized image ingress cancels stale reads and enforces limits against the latest draft", async () => {
  const gate = deferred();
  let current = [];
  const ingress = new AttachmentIngress(() => gate.promise);
  const item = (id) => ({
    id,
    name: id,
    mime: "image/png",
    type: "image",
    data: "same",
    size: 1,
  });
  const commit = (next) => {
    current = next;
  };
  const first = ingress.receive(
    [item("a")],
    "host",
    100,
    () => current,
    commit,
  );
  const second = ingress.receive(
    [item("b")],
    "paste",
    101,
    () => current,
    commit,
  );
  await new Promise((r) => setImmediate(r));
  gate.resolve("pixels");
  await Promise.all([first, second]);
  assert.equal(current.length, 1);
  const delayedGate = deferred();
  const delayed = new AttachmentIngress(() => delayedGate.promise);
  const old = delayed.receive(
    [item("old")],
    "paste",
    102,
    () => current,
    commit,
  );
  await new Promise((r) => setImmediate(r));
  delayed.reset();
  current = [];
  delayedGate.resolve("pixels");
  await old;
  assert.equal(
    current.length,
    0,
    "old input must not move into a new conversation",
  );
  current = Array.from({ length: 10 }, (_, i) => item(String(i)));
  const result = await ingress.receive(
    [item("overflow")],
    "file",
    103,
    () => current,
    commit,
  );
  assert.equal(result.overLimit, true);
  assert.equal(current.length, 10);
});
test("the same image from textarea paste and uTools img entry is added once in either order", async (t) => {
  const previousReader = global.FileReader;
  global.FileReader = class {
    readAsDataURL(file) {
      file.arrayBuffer().then((bytes) => {
        this.result = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;
        this.onload();
      });
    }
  };
  t.after(() => {
    global.FileReader = previousReader;
  });
  for (const hostFirst of [true, false]) {
    const h = appHarness(t);
    h.render();
    const entry = {
      code: "chat",
      type: "img",
      payload: "data:image/png;base64,aW1hZ2U=",
    };
    const paste = () =>
      h
        .render()
        .composer.onFiles(
          [new File(["image"], "image.png", { type: "image/png" })],
          "paste",
        );
    if (hostFirst) {
      await h.enter(entry);
      paste();
    } else {
      paste();
      await tick();
      await h.enter(entry);
    }
    await tick();
    assert.equal(
      h.render().composer.attachments.length,
      1,
      hostFirst ? "host before paste" : "paste before host",
    );
  }
});
test("App merges differently encoded host and paste images and handles screenshot echoes", async (t) => {
  const nativeData =
    "data:image/png;base64," + Buffer.from("native-png").toString("base64");
  const clipboardBytes = "clipboard-png-with-extra-metadata";
  const pastedData =
    "data:image/png;base64," + Buffer.from(clipboardBytes).toString("base64");
  decodedImages(
    t,
    new Map([
      [nativeData, [10, 20, 30, 255]],
      [pastedData, [10, 20, 30, 255]],
    ]),
  );
  const previousReader = global.FileReader;
  global.FileReader = class {
    readAsDataURL(file) {
      file.arrayBuffer().then((bytes) => {
        this.result = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;
        this.onload();
      });
    }
  };
  t.after(() => {
    global.FileReader = previousReader;
  });
  const h = appHarness(t, async () => nativeData);
  h.render().composer.onFiles(
    [new File([clipboardBytes], "image.png", { type: "image/png" })],
    "paste",
  );
  await tick();
  await h.enter({ code: "chat", type: "img", payload: nativeData });
  assert.equal(h.render().composer.attachments.length, 1);
  assert.equal(
    h.render().composer.attachments[0].data,
    pastedData,
    "keep original bytes, not a recompressed image",
  );
  h.render().list.onNew();
  h.render().composer.onCapture();
  await tick();
  await h.enter({ code: "chat", type: "img", payload: nativeData });
  h.render().composer.onFiles(
    [new File([clipboardBytes], "image.png", { type: "image/png" })],
    "paste",
  );
  await tick();
  assert.equal(
    h.render().composer.attachments.length,
    1,
    "capture, host and clipboard are one operation",
  );
  h.render().composer.onFiles(
    [new File([clipboardBytes], "image.png", { type: "image/png" })],
    "paste",
  );
  await tick();
  assert.equal(
    h.render().composer.attachments.length,
    2,
    "a subsequent explicit paste is still allowed",
  );
});
test("image echoes do not consume the remaining attachment slot before a new image", async (t) => {
  const previousReader = global.FileReader;
  global.FileReader = class {
    readAsDataURL(file) {
      file.arrayBuffer().then((bytes) => {
        this.result = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;
        this.onload();
      });
    }
  };
  t.after(() => {
    global.FileReader = previousReader;
  });
  const h = appHarness(t);
  h.render().composer.onFiles(
    Array.from(
      { length: 8 },
      (_, i) => new File(["text"], `${i}.txt`, { type: "text/plain" }),
    ),
  );
  await tick();
  await h.enter({
    code: "chat",
    type: "img",
    payload: "data:image/png;base64,aW1hZ2U=",
  });
  assert.equal(h.render().composer.attachments.length, 9);
  h.render().composer.onFiles(
    [
      new File(["image"], "image.png", { type: "image/png" }),
      new File(["new"], "new.png", { type: "image/png" }),
    ],
    "paste",
  );
  await tick();
  const attachments = h.render().composer.attachments;
  assert.equal(attachments.length, 10);
  assert.ok(attachments.some((item) => item.name === "new.png"));
});
test("a pending screenshot command cannot clear or submit a newer conversation draft", async (t) => {
  const gate = deferred();
  const h = appHarness(t, () => gate.promise);
  h.render();
  const entry = h.enter({ code: "screenshot-ask", type: "text", payload: "" });
  h.render().list.onNew();
  h.render().composer.setDraft("new conversation draft");
  gate.resolve("data:image/png;base64,aW1hZ2U=");
  await entry;
  assert.equal(h.render().composer.draft, "new conversation draft");
  assert.equal(h.render().composer.attachments.length, 0);
  assert.equal(h.pending.size, 0);
});
test("one paste batch deduplicates equivalent images but a separate paste remains intentional", async (t) => {
  const h = appHarness(t);
  const previousReader = global.FileReader;
  global.FileReader = class {
    readAsDataURL(file) {
      file.arrayBuffer().then((bytes) => {
        this.result = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;
        this.onload();
      });
    }
  };
  t.after(() => {
    global.FileReader = previousReader;
  });
  const image = () =>
    new File(["same-image"], "clipboard.png", { type: "image/png" });
  h.render().composer.onFiles([image(), image()], "paste");
  await tick();
  assert.equal(h.render().composer.attachments.length, 1);
  h.render().composer.onFiles([image()], "paste");
  await tick();
  assert.equal(h.render().composer.attachments.length, 2);
});
test("screenshot preference persists and concurrent capture clicks add only one image", async (t) => {
  const gate = deferred();
  const h = appHarness(t, () => gate.promise);
  h.render().composer.onCapturePreferenceChange(false);
  assert.equal(h.render().state.settings.screenshotHideWindow, false);
  await tick();
  assert.equal(h.saves.at(-1).settings.screenshotHideWindow, false);
  h.render().composer.onCapture();
  h.render().composer.onCapture();
  assert.deepEqual(h.screenshots, [{ hideWindow: false }]);
  gate.resolve("data:image/png;base64,aW1hZ2U=");
  await tick();
  assert.equal(h.render().composer.attachments.length, 1);
});
test("screenshot ask captures with current preference and image entry bypasses another capture", async (t) => {
  const h = appHarness(t);
  h.render().composer.onCapturePreferenceChange(false);
  await h.enter({ code: "screenshot-ask", type: "text", payload: "" });
  assert.deepEqual(h.screenshots, [{ hideWindow: false }]);
  assert.equal(h.pending.size, 1);
  const request = [...h.pending.values()][0];
  assert.equal(request.args.provider.id, "p");
  assert.equal(request.args.messages[0].attachments.length, 1);
  assert.match(request.args.messages[0].content, /截图/);
  assert.doesNotMatch(request.args.messages[0].content, /翻译/);
  request.event({ type: "done" });
  request.resolve();
  await tick();
  const image = "data:image/png;base64,b3RoZXI=";
  await h.enter({ code: "screenshot-ask", type: "img", payload: image });
  assert.equal(h.screenshots.length, 1);
  const second = [...h.pending.values()].at(-1);
  assert.equal(second.args.messages[0].attachments[0].data, image);
  second.event({ type: "done" });
  second.resolve();
  await tick();
});
test("Composer consumes each paste event once and right-click changes preference without capturing", () => {
  const slots = [];
  let cursor = 0;
  const hooks = {
    memo: (fn) => fn,
    useState: (value) => {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = typeof value === "function" ? value() : value;
      return [
        slots[index],
        (next) => {
          slots[index] = typeof next === "function" ? next(slots[index]) : next;
        },
      ];
    },
    useRef: (value) => {
      const index = cursor++;
      return (slots[index] ||= { current: value });
    },
    useMemo: (fn) => {
      cursor++;
      return fn();
    },
    useEffect: () => {
      cursor++;
    },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const { Composer, clipboardFiles } = compile(
    "ChatUI.tsx",
    {
      react: hooks,
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
      "lucide-react": new Proxy({}, { get: () => () => null }),
      "./bridge": { bridge: {} },
    },
    ["react", "react/jsx-runtime", "lucide-react", "./bridge"],
  );
  const pasted = [];
  let captures = 0;
  const props = {
    draft: "",
    setDraft: () => {},
    attachments: [],
    onRemove: () => {},
    onFiles: (...args) => pasted.push(args),
    onCapture: () => {
      captures++;
    },
    onCapturePreferenceChange: (hideWindow) => {
      props.settings = { ...props.settings, screenshotHideWindow: hideWindow };
    },
    onPasteText: () => false,
    onSend: () => {},
    onStop: () => {},
    busy: false,
    settings: mergeState(null).settings,
    onToolPermissionChange: () => {},
    toolCount: 0,
    toolsOpen: false,
    setToolsOpen: () => {},
    config: {},
    effort: "auto",
    setEffort: () => {},
    contextTokens: 0,
    contextEstimated: true,
    outputRate: 0,
    outputTokens: 0,
    editing: false,
    onCancelEdit: () => {},
  };
  const all = (node, predicate) => {
    if (!node) return [];
    if (Array.isArray(node))
      return node.flatMap((child) => all(child, predicate));
    return [
      ...(predicate(node.props || {}) ? [node.props] : []),
      ...all(node.props?.children, predicate),
    ];
  };
  const render = () => {
    cursor = 0;
    return Composer(props);
  };
  const image = { name: "image.png", type: "image/png", size: 4 };
  const clipboard = {
    files: [image, image],
    items: [{ kind: "file", getAsFile: () => image }],
    getData: () => "",
  };
  assert.deepEqual(clipboardFiles(clipboard), [image]);
  assert.deepEqual(clipboardFiles({ files: [image, image], items: [] }), [
    image,
  ]);
  const input = all(render(), (p) => p["aria-label"] === "消息输入框")[0];
  const nativeEvent = {};
  const event = {
    nativeEvent,
    clipboardData: clipboard,
    preventDefault() {},
    stopPropagation() {},
  };
  input.onPaste(event);
  input.onPaste(event);
  assert.equal(pasted.length, 1);
  assert.equal(pasted[0][1], "paste");
  input.onPaste({ ...event, nativeEvent: {} });
  assert.equal(pasted.length, 2);
  const trigger = all(render(), (p) =>
    p.className?.includes("capture-trigger"),
  )[0];
  trigger.onContextMenu({ preventDefault() {}, stopPropagation() {} });
  assert.equal(captures, 0);
  const choices = all(render(), (p) => p.role === "menuitemradio");
  assert.equal(choices.length, 2);
  assert.equal(choices[0]["aria-checked"], true);
  assert.equal(choices[1]["aria-checked"], false);
  choices[1].onClick();
  assert.equal(props.settings.screenshotHideWindow, false);
  assert.equal(all(render(), (p) => p.role === "menu").length, 0);
  all(render(), (p) => p.className?.includes("capture-trigger"))[0].onClick();
  assert.equal(captures, 1);
});
test("conversation rows and collapsed groups render independent loading indicators", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const ConversationList = compile("ConversationList.tsx", {}, [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "lucide-react",
  ]).default;
  const props = {
    conversations: ["a", "b"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      groupId: id,
    })),
    groups: ["a", "b"].map((id) => ({ id, name: id, color: "#4d9d80" })),
    runningIds: new Set(["a", "b"]),
    waitingIds: new Set(["a"]),
    onSelect: () => {},
    onNew: () => {},
    onAction: () => true,
    onExport: () => {},
    notify: () => {},
  };
  const rows = renderToStaticMarkup(
    React.createElement(ConversationList, props),
  );
  assert.equal((rows.match(/aria-label="等待授权"/g) || []).length, 1);
  assert.equal((rows.match(/aria-label="正在回复"/g) || []).length, 1);
  const groups = renderToStaticMarkup(
    React.createElement(ConversationList, {
      ...props,
      groups: props.groups.map((g) => ({ ...g, collapsed: true })),
    }),
  );
  // Collapsed rows stay mounted but inert; only their group headers are visible.
  const headers = (
    groups.match(
      /<button[^>]*class="conversation-group-toggle"[\s\S]*?<\/button>/g,
    ) || []
  ).join("");
  assert.equal((headers.match(/aria-label="等待授权"/g) || []).length, 1);
  assert.equal((headers.match(/aria-label="正在回复"/g) || []).length, 1);
});
test("preview bridge isolates abort signals, consumes final NDJSON and releases failed fetch locks", async (t) => {
  const previousWindow = global.window,
    previousLocation = global.location;
  global.window = {};
  global.location = { protocol: "http:" };
  t.after(() => {
    global.window = previousWindow;
    global.location = previousLocation;
  });
  const streams = new Map();
  let failures = 1;
  t.mock.method(global, "fetch", async (_url, options) => {
    const id = JSON.parse(options.body).conversationId;
    if (id === "retry" && failures-- > 0) throw new Error("fetch failed");
    return new Response(
      new ReadableStream({
        start(controller) {
          streams.set(id, { controller, signal: options.signal });
          options.signal.addEventListener(
            "abort",
            () =>
              controller.error(
                Object.assign(new Error("stopped"), { name: "AbortError" }),
              ),
            { once: true },
          );
        },
      }),
      { status: 200 },
    );
  });
  const { bridge } = compile("bridge.ts");
  const events = { a: [], b: [], retry: [] };
  const start = (id) =>
    bridge.chat({ conversationId: id }, (event) => events[id].push(event));
  const a = start("a"),
    b = start("b");
  await new Promise((r) => setImmediate(r));
  await assert.rejects(start("b"), /当前会话/);
  bridge.stop("a");
  await a;
  assert.equal(streams.get("b").signal.aborted, false);
  assert.ok(events.a.some((e) => e.text === "stopped"));
  const encoder = new TextEncoder();
  streams
    .get("b")
    .controller.enqueue(
      encoder.encode('{"type":"text","text":"独立完成"}\n{"type":"done"}'),
    );
  streams.get("b").controller.close();
  await b;
  assert.equal(events.b[0].text, "独立完成");
  assert.equal(events.b.at(-1).type, "done");
  await assert.rejects(start("retry"), /fetch failed/);
  const retry = start("retry");
  await new Promise((r) => setImmediate(r));
  bridge.stop("retry");
  await retry;
  assert.ok(events.retry.some((e) => e.text === "stopped"));
});
