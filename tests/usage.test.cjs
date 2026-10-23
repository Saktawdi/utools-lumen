const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const path = require("node:path");
const compiled = new Module(path.join(__dirname, "usage-bundle.cjs"), module);
compiled.filename = path.join(__dirname, "usage-bundle.cjs");
compiled._compile(
  buildSync({
    entryPoints: [path.join(__dirname, "../src/usage-data.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
  }).outputFiles[0].text,
  compiled.filename,
);
const { usageSummary, filterUsage, dailyUsage, modelUsage, usageCsv } =
  compiled.exports;
const row = (patch = {}) => ({
  id: "one",
  startedAt: Date.now(),
  completedAt: Date.now(),
  providerId: "p",
  providerName: "Provider",
  model: "chat",
  kind: "chat",
  status: "success",
  reported: true,
  input: 100,
  output: 50,
  cachedInput: 30,
  reasoning: 10,
  ...patch,
});
test("usage totals do not add cached or reasoning subsets twice; model groups retain provider identity", () => {
  const rows = [
    row(),
    row({
      id: "two",
      providerId: "q",
      providerName: "Other",
      input: 20,
      output: 10,
      cachedInput: 0,
      kind: "image",
      images: 2,
    }),
    row({
      id: "three",
      input: 0,
      output: 0,
      cachedInput: 0,
      reasoning: 0,
      reported: false,
      status: "cancelled",
    }),
  ];
  const total = usageSummary(rows);
  assert.equal(total.input + total.output, 180);
  assert.equal(total.requests, 3);
  assert.equal(total.unreported, 1);
  assert.equal(total.images, 2);
  assert.equal(modelUsage(rows).length, 2);
  assert.equal(filterUsage(rows, "all", "q", "image").length, 1);
});
test("date filters and empty daily buckets use local midnight across daylight-saving changes", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const now = Date.parse("2026-11-02T12:00:00Z");
    const rows = [
      row({ startedAt: Date.parse("2026-11-02T04:59:59Z") }),
      row({ id: "two", startedAt: Date.parse("2026-11-02T05:00:00Z") }),
    ];
    assert.equal(filterUsage(rows, "1", "", "", now).length, 1);
    const days = dailyUsage(rows, 3, now);
    assert.deepEqual(
      days.map((d) => d.day),
      ["2026-10-31", "2026-11-01", "2026-11-02"],
    );
    assert.deepEqual(
      days.map((d) => d.requests),
      [0, 1, 1],
    );
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
test("CSV exports retain exact counts, escape quotes and neutralize spreadsheet formulas", () => {
  const csv = usageCsv([
    row({ providerName: '=HYPERLINK("example")', model: 'a,"b"' }),
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('"a,""b"""'));
  assert.ok(csv.includes('"100","50","30","0","10"'));
});
