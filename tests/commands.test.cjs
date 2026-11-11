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
const { addTranslationLanguage, removeTranslationLanguage } = compiled.exports;
test("managed translation languages add, deduplicate, and keep a valid default after deletion", () => {
  const initial = {
    translationLanguages: ["cn", "en"],
    translationLanguage: "en",
  };
  const added = addTranslationLanguage(initial, "  葡萄牙语  ");
  assert.deepEqual(added.translationLanguages, ["cn", "en", "葡萄牙语"]);
  assert.equal(added.translationLanguage, "en");
  for (const duplicate of ["EN", "英语", "zh-CN", "简体中文"])
    assert.throws(() => addTranslationLanguage(added, duplicate), /已在列表/);
  for (const invalid of [" ", "x".repeat(81)])
    assert.throws(() => addTranslationLanguage(added, invalid));
  const selected = { ...added, translationLanguage: "葡萄牙语" };
  assert.match(
    quickRequest("translate", "Hello", selected.translationLanguage).prompt,
    /翻译成葡萄牙语/,
  );
  assert.match(
    quickRequest("screenshot-translate", "", selected.translationLanguage)
      .prompt,
    /翻译成葡萄牙语/,
  );
  const deleted = removeTranslationLanguage(selected, "葡萄牙语");
  assert.equal(deleted.translationLanguage, "cn");
  const last = removeTranslationLanguage(deleted, "en");
  assert.deepEqual(removeTranslationLanguage(last, "cn"), last);
  assert.deepEqual(initial.translationLanguages, ["cn", "en"]);
});
test("release metadata uses the same version in package, lockfile and plugin manifest", () => {
  const packageInfo = require("../package.json");
  const lock = require("../package-lock.json");
  const manifest = require("../public/plugin.json");
  assert.match(packageInfo.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, packageInfo.version);
  assert.equal(lock.packages[""].version, packageInfo.version);
  assert.equal(manifest.version, packageInfo.version);
});
test("screenshot ask is registered for command and image entry without translation instructions", () => {
  const manifest = require("../public/plugin.json");
  const feature = manifest.features.find((f) => f.code === "screenshot-ask");
  assert.ok(feature);
  assert.ok(feature.cmds.includes("AI截图问答"));
  assert.ok(feature.cmds.includes("ai screenshot ask"));
  assert.ok(
    feature.cmds.some(
      (cmd) => cmd.type === "img" && cmd.label === "AI截图问答",
    ),
  );
  const request = quickRequest("screenshot-ask", "请解释报错", "ja");
  assert.equal(request.title, "截图问答");
  assert.match(request.prompt, /截图/);
  assert.match(request.prompt, /请解释报错/);
  assert.doesNotMatch(request.prompt, /翻译|只输出译文/);
});
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
