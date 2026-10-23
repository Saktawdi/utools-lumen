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
    this.jobs = new Map();
    this.sequence = 0;
    this.writer = null;
    this.workerUnavailable = false;
    this.fallbackPending = Promise.resolve();
  }
  encode(value) {
    return this.encodeJSON(JSON.stringify(value));
  }
  encodeJSON(json) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
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
    // Prefer background serialization where the host supports Node Workers.
    clearTimeout(this.idleTimer);
    const writer = this.writer || this.createWriter();
    if (!writer) return this.writeFallback(name, value);
    const id = ++this.sequence;
    this.pending = new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      writer.ref();
      try {
        writer.postMessage({ id, name, value });
      } catch (error) {
        this.jobs.delete(id);
        if (!this.jobs.size) writer.unref();
        reject(error);
      }
    });
    return this.pending;
  }
  writeFallback(name, value) {
    // Capture the caller's snapshot before it can change. Embedded Node hosts
    // may expose worker_threads while rejecting Worker construction entirely.
    let json;
    try {
      json = JSON.stringify(value);
    } catch (error) {
      return Promise.reject(error);
    }
    this.fallbackPending = this.fallbackPending
      .catch(() => {})
      .then(async () => {
        const data = this.encodeJSON(json);
        const file = path.join(this.directory, name + ".enc");
        const temp = file + ".tmp";
        await fs.promises.writeFile(temp, data, { mode: 0o600 });
        try {
          await fs.promises.copyFile(file, file + ".bak");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        await fs.promises.rename(temp, file);
      });
    this.pending = this.fallbackPending;
    return this.pending;
  }
  createWriter() {
    if (this.workerUnavailable) return null;
    let writer;
    try {
      const { Worker } = require("node:worker_threads");
      writer = new Worker(path.join(__dirname, "storage-worker.cjs"), {
        workerData: { directory: this.directory, key: this.key },
      });
    } catch {
      this.workerUnavailable = true;
      return null;
    }
    this.writer = writer;
    const fail = (error) => {
      if (this.writer !== writer) return;
      this.writer = null;
      this.workerUnavailable = true;
      clearTimeout(this.idleTimer);
      for (const job of this.jobs.values()) job.reject(error);
      this.jobs.clear();
    };
    writer.on("message", ({ id, error }) => {
      const job = this.jobs.get(id);
      if (!job) return;
      this.jobs.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve();
      if (!this.jobs.size) {
        writer.unref();
        this.idleTimer = setTimeout(() => {
          if (this.writer === writer && !this.jobs.size) {
            this.writer = null;
            void writer.terminate();
          }
        }, 15000);
        this.idleTimer.unref();
      }
    });
    writer.on("error", fail);
    writer.on("exit", (code) => {
      fail(new Error(`本地保存线程已退出（${code}）`));
    });
    writer.unref();
    return writer;
  }
}
module.exports = { LocalStore, dataDirectory };
