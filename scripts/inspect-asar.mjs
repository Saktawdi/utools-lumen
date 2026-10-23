import fs from "node:fs";
import path from "node:path";
export function openAsar(file) {
  const fd = fs.openSync(file, "r");
  const size = Buffer.alloc(16);
  fs.readSync(fd, size, 0, 16, 0);
  const hsize = size.readUInt32LE(12);
  const buf = Buffer.alloc(hsize);
  fs.readSync(fd, buf, 0, hsize, 16);
  const header = JSON.parse(buf.toString());
  const offset = 8 + size.readUInt32LE(4);
  fs.closeSync(fd);
  return {
    header,
    read(name) {
      let entry = header;
      for (const p of name.split("/")) entry = entry.files[p];
      if (!entry || entry.unpacked) return null;
      const out = Buffer.alloc(entry.size);
      const source = fs.openSync(file, "r");
      fs.readSync(source, out, 0, entry.size, offset + Number(entry.offset));
      fs.closeSync(source);
      return out;
    },
    list() {
      const result = [];
      function walk(n, p = "") {
        for (const [name, e] of Object.entries(n.files ?? {})) {
          const q = p + name;
          if (e.files) walk(e, q + "/");
          else result.push(q);
        }
      }
      walk(header);
      return result;
    },
  };
}
if (process.argv[2]) {
  const arg = process.argv[2];
  if (fs.statSync(arg).isDirectory()) {
    for (const file of fs.readdirSync(arg).filter((x) => x.endsWith(".asar"))) {
      try {
        const a = openAsar(path.join(arg, file));
        const p = a.read("plugin.json");
        console.log(
          file,
          p
            ? JSON.stringify(JSON.parse(p.toString()))
            : a.list().slice(0, 8).join(","),
        );
      } catch (e) {
        console.log(file, e.message);
      }
    }
  } else {
    const a = openAsar(arg);
    if (process.argv[3]) console.log(a.read(process.argv[3])?.toString());
    else
      console.log(
        a
          .list()
          .filter((x) => /preload|plugin.json|package.json|develop/i.test(x))
          .join("\n"),
      );
  }
}
