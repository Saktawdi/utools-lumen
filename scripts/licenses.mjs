import fs from "node:fs";
import path from "node:path";

const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const sections = [];
for (const [location, info] of Object.entries(lock.packages)) {
  if (!location || info.dev) continue;
  const directory = path.join(location, "");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  const names = fs
    .readdirSync(directory)
    .filter((name) => /^(license|copying|notice)([._-]|$)/i.test(name))
    .sort();
  if (!names.length && manifest.name !== "proxy-agent-negotiate")
    throw new Error(`依赖 ${manifest.name} 未附带许可证文本`);
  const heading = `===== ${manifest.name}@${manifest.version} (${manifest.license || "unspecified"}) =====`;
  if (names.length) {
    for (const name of names)
      sections.push(
        `${heading} · ${name}\n\n${fs.readFileSync(path.join(directory, name), "utf8").trim()}`,
      );
  } else {
    sections.push(
      `${heading}\n\nCopyright (c) Nathan Rajlich <nathan@tootallnate.net>\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
    );
  }
}
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/THIRD_PARTY_NOTICES.txt", sections.join("\n\n"));
