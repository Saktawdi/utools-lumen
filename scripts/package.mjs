import fs from "node:fs";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
const manifest = JSON.parse(fs.readFileSync("dist/plugin.json", "utf8"));
const files = {};
function collect(directory, relative = "") {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = relative + entry.name;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file, name + "/");
    else files["Lumen/" + name] = fs.readFileSync(file);
  }
}
collect("dist");
files["安装说明.txt"] = strToU8(
  "解压后，在 uTools 开发者工具中导入 Lumen/plugin.json，点击接入开发并运行。\n本 ZIP 用于本地源码导入；uTools 8 的 .upxs 安装包请通过开发者工具的打包功能生成。\n不需要运行 Node 或开发服务器。\n",
);
fs.mkdirSync("release", { recursive: true });
const output = `release/lumen-${manifest.version}-local.zip`;
fs.writeFileSync(output, zipSync(files, { level: 9 }));
console.log(
  `${output} · ${(fs.statSync(output).size / 1024).toFixed(0)} KB · 本地导入包`,
);
