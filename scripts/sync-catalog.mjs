import fs from "node:fs/promises";
import { transform } from "esbuild";
import { format } from "prettier";

// Keep the browser and native matcher identical without a runtime dependency.
const target = new URL("../runtime/catalog.cjs", import.meta.url);
const source = await fs.readFile(
  new URL("../src/model-catalog.ts", import.meta.url),
  "utf8",
);
const { code } = await transform(source, {
  loader: "ts",
  format: "cjs",
  target: "node18",
});
const generated = await format(
  "// Generated from src/model-catalog.ts by scripts/sync-catalog.mjs.\n" +
    code,
  { parser: "babel" },
);
if (process.argv.includes("--check")) {
  const current = await fs.readFile(target, "utf8");
  if (current.replace(/\r\n/g, "\n") !== generated) {
    throw new Error(
      "模型匹配运行时未同步，请运行 node scripts/sync-catalog.mjs",
    );
  }
} else {
  await fs.writeFile(target, generated);
}
