const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const path = require("node:path");
const filename = path.join(__dirname, "key-import-bundle.cjs");
const source = buildSync({
  entryPoints: [path.join(__dirname, "../src/ui.tsx")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
}).outputFiles[0].text;
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled._compile(source, filename);
const { parseKeys } = compiled.exports;

test("bulk credentials accept documented formats, strip Bearer and deduplicate", () => {
  assert.deepEqual(parseKeys("Bearer demo-a\ndemo-b, demo-a"), [
    "demo-a",
    "demo-b",
  ]);
  assert.deepEqual(
    parseKeys('{"keys":["demo-a",{"apiKey":"demo-b"},{"key":"demo-a"}]}'),
    ["demo-a", "demo-b"],
  );
  assert.deepEqual(parseKeys("123-example-key"), ["123-example-key"]);
});
test("invalid JSON credentials are rejected without treating the source as a key", () => {
  for (const raw of [
    "null",
    "[]",
    "{}",
    "[1]",
    '["demo",null]',
    "[broken",
    '{"key":3}',
  ])
    assert.throws(() => parseKeys(raw));
});
