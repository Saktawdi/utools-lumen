const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const path = require("node:path");
const filename = path.join(__dirname, "catalog-bundle.cjs");
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled._compile(
  buildSync({
    entryPoints: [path.join(__dirname, "../src/model-catalog.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
  }).outputFiles[0].text,
  filename,
);
const nativeMatch = require("../runtime/catalog.cjs").matchModel;
for (const [name, match] of [
  ["UI", compiled.exports.matchModel],
  ["runtime", nativeMatch],
]) {
  test(
    name + " keeps architecture versions distinct while allowing a dated alias",
    () => {
      const entries = {
        original: {
          id: "deepseek-v3",
          providerId: "deepseek",
          limit: { context: 64000 },
        },
      };
      assert.equal(match("deepseek-v4", entries), null);
      assert.equal(match("deepseek-v3-2026-05-14", entries).context, 64000);
    },
  );
  test(
    name +
      " model metadata prefers the original publisher and honors explicit namespaces",
    () => {
      const entries = {
        gateway: {
          id: "gpt-4o",
          providerId: "gateway",
          tool_call: false,
          limit: { context: 16000, output: 4096 },
        },
        original: {
          id: "gpt-4o",
          providerId: "openai",
          tool_call: true,
          modalities: { input: ["text", "image"] },
          limit: { context: 128000, output: 16384 },
        },
      };
      assert.equal(match("gpt-4o", entries).context, 128000);
      assert.equal(match("gpt-4o", entries).vision, true);
      assert.equal(match("gateway/gpt-4o", entries).tools, false);
      assert.equal(match("gpt-4o-unrelated", entries), null);
      assert.equal(match("unknown", entries), null);
    },
  );
  test(name + " leaves conflicting third party metadata unmatched", () => {
    const entries = {
      a: { id: "shared", providerId: "a", tool_call: true },
      b: { id: "shared", providerId: "b", tool_call: false },
    };
    assert.equal(match("shared", entries), null);
    assert.equal(match("b/shared", entries).tools, false);
  });
}
