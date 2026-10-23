import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
await build({
  entryPoints: ["runtime/preload.cjs"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "iife",
  outfile: "dist/preload.js",
  external: ["electron"],
  minify: false,
  banner: { js: "(function () { try {" },
  footer: {
    js: "} catch (error) { window.lumenBootError = String(error.stack || error); console.error('[Lumen preload]', error); } })();",
  },
});
for (const name of ["plugin.json", "logo.svg", "logo.png"])
  if (fs.existsSync("public/" + name))
    fs.copyFileSync("public/" + name, path.join("dist", name));
fs.copyFileSync("runtime/storage-worker.cjs", "dist/storage-worker.cjs");
fs.copyFileSync("LICENSE", "dist/LICENSE");
await import("./licenses.mjs");
// uTools loads preload through Node. Isolate it from the source project's ESM scope.
fs.writeFileSync(
  "dist/package.json",
  JSON.stringify({ private: true, type: "commonjs" }, null, 2) + "\n",
);
console.log("uTools 插件已构建：dist/plugin.json");
