import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
};
try {
  await import(pathToFileURL(path.resolve("dist/preload.js")).href);
  assert.equal(window.lumenBootError, undefined, window.lumenBootError);
  assert.equal(typeof window.lumen?.load, "function");
  assert.equal(await window.lumen.load(), null);
  const snapshot = { settings: { providers: [] }, conversations: [] };
  await window.lumen.save(snapshot);
  assert.deepEqual(await window.lumen.load(), snapshot);
  assert.ok(
    (await window.lumen.tools()).some((tool) => tool.name === "list_tools"),
  );
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
  console.log(
    "宿主加载检查通过：Node 模块、存储、工具注册、快捷指令队列、截图复制及取消恢复",
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
