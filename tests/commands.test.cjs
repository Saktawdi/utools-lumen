const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const path = require("node:path");
const filename = path.join(__dirname, "commands-bundle.cjs");
const source = buildSync({
  entryPoints: [path.join(__dirname, "../src/quick-commands.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
}).outputFiles[0].text;
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled._compile(source, filename);
const { quickRequest, languageName } = compiled.exports;
test("quick commands preserve selected content, resolve cn and custom target languages, and distinguish image requests", () => {
  const text = "Hello\nWorld";
  const translation = quickRequest("translate", text);
  assert.ok(translation.prompt.includes(text));
  assert.ok(translation.prompt.includes("简体中文"));
  assert.equal(languageName("zh-TW"), "繁體中文");
  assert.equal(languageName("葡萄牙语"), "葡萄牙语");
  assert.ok(
    quickRequest("screenshot-translate", "", "ja").prompt.includes("日语"),
  );
  assert.ok(quickRequest("ask", "2+2?").prompt.includes("2+2?"));
  assert.ok(!quickRequest("ask", "2+2?").prompt.includes("翻译"));
});
