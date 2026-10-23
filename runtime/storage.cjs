const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
function dataDirectory() {
  return (
    process.env.LUMEN_DATA_DIR ||
    path.join(
      process.env.APPDATA || path.join(os.homedir(), ".config"),
      "uTools",
      "lumen",
    )
  );
}
class LocalStore {
  constructor(directory = dataDirectory()) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
    const keyPath = path.join(directory, "vault.key");
    if (!fs.existsSync(keyPath))
      fs.writeFileSync(keyPath, crypto.randomBytes(32), {
        mode: 0o600,
        flag: "wx",
      });
    this.key = fs.readFileSync(keyPath);
    this.pending = Promise.resolve();
  }
  encode(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([Buffer.from("LMN1"), iv, cipher.getAuthTag(), data]);
  }
  decode(value) {
    if (value.subarray(0, 4).toString() !== "LMN1")
      throw new Error("本地数据格式无效");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.key,
      value.subarray(4, 16),
    );
    decipher.setAuthTag(value.subarray(16, 32));
    return JSON.parse(
      Buffer.concat([
        decipher.update(value.subarray(32)),
        decipher.final(),
      ]).toString("utf8"),
    );
  }
  read(name, fallback = null) {
    const file = path.join(this.directory, name + ".enc");
    if (!fs.existsSync(file)) return fallback;
    return this.decode(fs.readFileSync(file));
  }
  write(name, value) {
    const data = this.encode(value);
    const file = path.join(this.directory, name + ".enc");
    const temp = file + ".tmp";
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        await fs.promises.writeFile(temp, data, { mode: 0o600 });
        if (fs.existsSync(file))
          await fs.promises.copyFile(file, file + ".bak");
        await fs.promises.rename(temp, file);
      });
    return this.pending;
  }
}
module.exports = { LocalStore, dataDirectory };
