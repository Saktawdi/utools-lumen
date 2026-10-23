const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
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
    // Clone the snapshot now; stringify, encrypt and atomic writes run off the UI thread.
    clearTimeout(this.idleTimer);
    const writer = this.writer || this.createWriter();
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
  createWriter() {
    const writer = new Worker(path.join(__dirname, "storage-worker.cjs"), {
      workerData: { directory: this.directory, key: this.key },
    });
    this.writer = writer;
    const fail = (error) => {
      if (this.writer !== writer) return;
      this.writer = null;
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
