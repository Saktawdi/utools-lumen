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
