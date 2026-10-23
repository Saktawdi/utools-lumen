const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const key = Buffer.from(workerData.key);
let pending = Promise.resolve();

parentPort.on("message", ({ id, name, value }) => {
  // One queue owns each temporary file, including when a previous save fails.
  pending = pending
    .catch(() => {})
    .then(async () => {
      try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        const encrypted = Buffer.concat([
          cipher.update(JSON.stringify(value), "utf8"),
          cipher.final(),
        ]);
        // Preserve LMN1 so existing installations and backups remain readable.
        const data = Buffer.concat([
          Buffer.from("LMN1"),
          iv,
          cipher.getAuthTag(),
          encrypted,
        ]);
        const file = path.join(workerData.directory, name + ".enc");
        const temp = file + ".tmp";
        await fs.writeFile(temp, data, { mode: 0o600 });
        try {
          await fs.copyFile(file, file + ".bak");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        await fs.rename(temp, file);
        parentPort.postMessage({ id });
      } catch (error) {
        parentPort.postMessage({ id, error: error.message || "本地保存失败" });
      }
    });
});
