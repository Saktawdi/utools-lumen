const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { request, assertOk } = require("./transport.cjs");
const { endpoint } = require("./adapters.cjs");
const { withKeys } = require("./search.cjs");
const { normalizeUsage } = require("./usage.cjs");
const imageProfiles = require("../src/image-profiles.json");
function profileFor(model, protocol) {
  const id =
    protocol === "google-images"
      ? "google"
      : imageProfiles.rules.find((rule) =>
          new RegExp(rule.pattern, "i").test(model),
        )?.profile || "default";
  return imageProfiles.profiles[id];
}
const MAX_IMAGE = 16 * 1024 * 1024;
const safeId = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(id);
function mimeOf(buffer) {
  if (buffer.length < 12) throw new Error("供应商返回的图片文件不完整");
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return "image/jpeg";
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  throw new Error("图片格式无效，需要 PNG、JPEG 或 WebP");
}
function imageBytes(data) {
  const match = /^data:image\/(png|jpe?g|webp);base64,([\s\S]+)$/i.exec(
    String(data),
  );
  if (
    !match ||
    !/^[a-zA-Z0-9+/=\r\n]+$/.test(match[2]) ||
    match[2].length > MAX_IMAGE * 1.4
  )
    throw new Error("参考图需要 PNG、JPEG 或 WebP，且小于 16 MB");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_IMAGE) throw new Error("图片超过 16 MB");
  return { buffer, mime: mimeOf(buffer) };
}

function explainImageError(error, model) {
  const message = String(error?.message || error);
  if (!/images endpoint requires an image model/i.test(message)) return message;
  const id = String(model || "当前模型")
    .replace(/\s+/g, " ")
    .trim();
  return (
    `${message.split(" · ")[0]} · 供应商没有把「${id}」映射到 Images 生图路由。` +
    "它本身可能是扩散生图模型，但当前网关仍会拒绝这个模型；请在供应商后台启用 image-generation 映射，或改用该接口已登记的生图模型。"
  );
}
function multipart(fields, references, field = "image[]") {
  const boundary = "lumen-" + crypto.randomUUID();
  const chunks = [];
  for (const [name, value] of Object.entries(fields))
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  for (const [index, ref] of references.entries()) {
    const { buffer, mime } = imageBytes(ref.data);
    const ext = mime.split("/")[1];
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="reference-${index}.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`,
      ),
      buffer,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    headers: { "Content-Type": "multipart/form-data; boundary=" + boundary },
  };
}
function validateRequest(args) {
  const p = args?.provider;
  if (
    !p ||
    p.enabled === false ||
    !["openai-images", "google-images"].includes(p.protocol)
  )
    throw new Error("请选择已启用的生图供应商");
  const url = new URL(p.baseURL);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("生图 API 地址无效");
  if (!safeId(args.id)) throw new Error("生成任务 ID 无效");
  if (
    typeof args.prompt !== "string" ||
    !args.prompt.trim() ||
    args.prompt.length > 32000
  )
    throw new Error("请输入 1–32000 字的画面描述");
  if (
    typeof args.model !== "string" ||
    !args.model.trim() ||
    args.model.length > 200
  )
    throw new Error("请选择生图模型");
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 4)
    throw new Error("一次可生成 1–4 张图片");
  if (p.protocol === "google-images" && args.count !== 1)
    throw new Error("Gemini 生图一次请求支持 1 张图片");
  if (!Array.isArray(args.references) || args.references.length > 4)
    throw new Error("最多添加 4 张参考图");
  for (const ref of args.references) imageBytes(ref.data);
  if (!/^(auto|\d{2,4}x\d{2,4}|\d{1,2}:\d{1,2})$/.test(args.size))
    throw new Error("图片尺寸无效");
  if (
    ![
      "auto",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "standard",
      "hd",
    ].includes(args.quality)
  )
    throw new Error("图片质量参数无效");
  if (!["auto", "opaque", "transparent"].includes(args.background))
    throw new Error("图片背景参数无效");
  const profile = profileFor(args.model, p.protocol);
  if (args.count > profile.maxCount)
    throw new Error("这个模型一次最多生成 " + profile.maxCount + " 张图片");
  if (args.references.length > profile.maxReferences)
    throw new Error(
      profile.maxReferences
        ? "这个模型最多支持 " + profile.maxReferences + " 张参考图"
        : "这个模型不支持参考图，请切换模型",
    );
  if (!profile.qualities.includes(args.quality))
    throw new Error("这个模型不支持所选的质量档位");
  if (!profile.background && args.background !== "auto")
    throw new Error("这个模型不支持背景参数");
  if (p.protocol === "google-images" && !profile.sizes.includes(args.size))
    throw new Error("Gemini 请使用支持的画面比例");
  if (p.protocol !== "google-images" && args.size.includes(":"))
    throw new Error("OpenAI Images 请填写像素尺寸，例如 1024x1024");
  if (/dall-e-/i.test(args.model) && !profile.sizes.includes(args.size))
    throw new Error("这个模型不支持所选尺寸");
  if (/dall-e-2/i.test(args.model))
    for (const ref of args.references) {
      const image = imageBytes(ref.data);
      if (
        image.mime !== "image/png" ||
        image.buffer.length >= 4 * 1024 * 1024 ||
        image.buffer.length < 24 ||
        image.buffer.toString("ascii", 12, 16) !== "IHDR" ||
        !image.buffer.readUInt32BE(16) ||
        image.buffer.readUInt32BE(16) !== image.buffer.readUInt32BE(20)
      )
        throw new Error("DALL·E 2 参考图需要小于 4 MB 的方形 PNG");
    }
}
class ImageStudio {
  constructor(store, ledger) {
    this.store = store;
    this.ledger = ledger;
    this.jobs = null;
    this.controllers = new Map();
    this.pending = Promise.resolve();
  }
  load() {
    if (!this.jobs) {
      this.jobs = this.store.read("studio", []);
      for (const job of this.jobs)
        if (job.status === "running") {
          job.status = "cancelled";
          job.error = "上次运行已中断，可重用参数再次生成";
          job.completedAt = Date.now();
        }
    }
    return this.jobs;
  }
  async persist() {
    const snapshot = structuredClone(this.load());
    this.pending = this.pending
      .catch(() => {})
      .then(() => this.store.write("studio", snapshot));
    await this.pending;
  }
  list() {
    return structuredClone(this.load());
  }
  asset(id, thumbnail = false) {
    if (!safeId(id)) throw new Error("图片 ID 无效");
    if (!fs.existsSync(path.join(this.store.directory, "image-" + id + ".enc")))
      throw new Error("图片已删除或不存在");
    const value =
      (thumbnail && this.store.read("image-" + id + "-thumb", null)) ||
      this.store.read("image-" + id, null);
    if (!value) throw new Error("图片已删除或不存在");
    return value.data;
  }
  async thumbnail(id, data) {
    if (
      !safeId(id) ||
      !fs.existsSync(path.join(this.store.directory, "image-" + id + ".enc"))
    )
      throw new Error("原图不存在");
    const image = imageBytes(data);
    if (image.buffer.length > 256 * 1024) throw new Error("缩略图超过 256 KB");
    await this.store.write("image-" + id + "-thumb", { data });
    if (!fs.existsSync(path.join(this.store.directory, "image-" + id + ".enc")))
      for (const suffix of ["-thumb.enc", "-thumb.enc.bak"])
        await fs.promises.rm(
          path.join(this.store.directory, "image-" + id + suffix),
          { force: true },
        );
  }
  cancel(id) {
    this.controllers.get(id)?.abort();
  }
  async favorite(id, favorite) {
    const job = this.load().find((j) => j.id === id);
    if (!job) throw new Error("找不到生成记录");
    job.favorite = favorite === true;
    await this.persist();
  }
  async remove(id) {
    const job = this.load().find((j) => j.id === id);
    if (!job) return;
    if (job.status === "running") throw new Error("请先停止生成再删除");
    this.jobs = this.load().filter((j) => j.id !== id);
    await this.persist();
    for (const asset of [...job.images, ...(job.references || [])]) {
      for (const suffix of [".enc", ".enc.bak", "-thumb.enc", "-thumb.enc.bak"])
        await fs.promises.rm(
          path.join(this.store.directory, "image-" + asset.id + suffix),
          { force: true },
        );
    }
  }
  async generate(args, signal) {
    validateRequest(args);
    if (this.controllers.size >= 2)
      throw new Error("已有两个生图任务在运行，请稍后重试");
    if (this.load().some((j) => j.id === args.id))
      throw new Error("此生成任务已提交");
    const p = args.provider;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    this.controllers.set(args.id, controller);
    const job = {
      id: args.id,
      providerId: p.id,
      providerName: p.name,
      model: args.model,
      prompt: args.prompt.trim(),
      size: args.size,
      quality: args.quality,
      count: args.count,
      background: args.background,
      referenceCount: args.references.length,
      references: [],
      status: "running",
      images: [],
      source: args.source || "studio",
      createdAt: Date.now(),
    };
    this.jobs.unshift(job);
    let usage;
    let status = "error";
    try {
      for (const reference of args.references) {
        const { buffer, mime } = imageBytes(reference.data);
        const refId = crypto.randomUUID();
        await this.store.write("image-" + refId, {
          data: `data:${mime};base64,${buffer.toString("base64")}`,
        });
        job.references.push({ id: refId, mime, size: buffer.length });
      }
      await this.persist();
      controller.signal.throwIfAborted();
      const google = p.protocol === "google-images";
      const references = args.references;
      const data = await withKeys(
        "image:" + p.id,
        p.keys || [],
        async (key) => {
          let url, body, headers;
          if (google) {
            url =
              p.baseURL.replace(/\/+$/, "") +
              "/models/" +
              encodeURIComponent(args.model.replace(/^models\//, "")) +
              ":generateContent";
            headers = { "x-goog-api-key": key, ...p.headers };
            const ratio =
              args.size === "auto"
                ? undefined
                : args.size.includes(":")
                  ? args.size
                  : args.size === "1536x1024"
                    ? "3:2"
                    : args.size === "1024x1536"
                      ? "2:3"
                      : "1:1";
            body = {
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: job.prompt },
                    ...references.map((r) => {
                      const { buffer, mime } = imageBytes(r.data);
                      return {
                        inlineData: {
                          mimeType: mime,
                          data: buffer.toString("base64"),
                        },
                      };
                    }),
                  ],
                },
              ],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                ...(ratio ? { imageConfig: { aspectRatio: ratio } } : {}),
              },
            };
          } else {
            const legacy = /^dall-e-/i.test(args.model);
            const fields = {
              model: args.model,
              prompt: job.prompt,
              n: args.count,
              ...(args.size !== "auto" ? { size: args.size } : {}),
              ...(args.quality !== "auto" ? { quality: args.quality } : {}),
              ...(!legacy && args.background !== "auto"
                ? { background: args.background }
                : {}),
              ...(legacy ? { response_format: "b64_json" } : {}),
            };
            url = endpoint(
              p.baseURL,
              references.length ? "images/edits" : "images/generations",
            );
            headers = {
              ...(key ? { Authorization: "Bearer " + key } : {}),
              ...p.headers,
            };
            body = fields;
            if (references.length) {
              const form = multipart(
                fields,
                references,
                /dall-e-2/i.test(args.model) ? "image" : "image[]",
              );
              body = form.body;
              headers = { ...headers, ...form.headers };
            }
          }
          const response = await assertOk(
            await request(url, {
              method: "POST",
              headers,
              body,
              signal: controller.signal,
              timeout: 300000,
            }),
          );
          return response.json(96 * 1024 * 1024);
        },
      );
      usage = google
        ? data.usageMetadata && normalizeUsage(data.usageMetadata, "google")
        : data.usage && normalizeUsage(data.usage, "openai");
      const candidates = google
        ? (data.candidates || []).flatMap((c) =>
            (c.content?.parts || [])
              .filter((part) => !part.thought)
              .map((part) => {
                const inline = part.inlineData || part.inline_data;
                return inline ? { b64_json: inline.data } : null;
              })
              .filter(Boolean),
          )
        : data.data || [];
      if (!candidates.length) {
        const explanation =
          data.candidates?.[0]?.content?.parts
            ?.map((p) => p.text || "")
            .join("") ||
          data.promptFeedback?.blockReason ||
          data.error?.message;
        throw new Error(
          explanation
            ? "未返回图片：" + explanation.slice(0, 600)
            : "供应商未返回图片，请检查模型是否支持生图",
        );
      }
      for (const item of candidates.slice(0, 4)) {
        controller.signal.throwIfAborted();
        let buffer;
        if (item.b64_json) {
          if (item.b64_json.length > MAX_IMAGE * 1.4)
            throw new Error("供应商返回的图片超过 16 MB");
          buffer = Buffer.from(item.b64_json, "base64");
        } else if (item.url) {
          // Signed output URLs are fetched without the provider's credentials.
          buffer = await (
            await assertOk(
              await request(item.url, { signal: controller.signal }),
            )
          ).buffer(MAX_IMAGE);
        } else continue;
        if (buffer.length > MAX_IMAGE)
          throw new Error("供应商返回的图片超过 16 MB");
        const mime = mimeOf(buffer),
          assetId = crypto.randomUUID();
        await this.store.write("image-" + assetId, {
          data: `data:${mime};base64,${buffer.toString("base64")}`,
        });
        job.images.push({
          id: assetId,
          mime,
          size: buffer.length,
          ...(item.revised_prompt
            ? { revisedPrompt: item.revised_prompt }
            : {}),
        });
      }
      if (!job.images.length) throw new Error("供应商返回的图片内容为空");
      job.status = "done";
      status = "success";
    } catch (error) {
      job.status = controller.signal.aborted ? "cancelled" : "error";
      status = controller.signal.aborted ? "cancelled" : "error";
      let message = controller.signal.aborted
        ? "已停止生成"
        : explainImageError(error, args.model);
      for (const key of [...(p.keys || []), ...Object.values(p.headers || {})])
        if (key) message = message.split(key).join("[密钥已隐藏]");
      job.error = message;
    } finally {
      signal?.removeEventListener("abort", abort);
      this.controllers.delete(args.id);
      job.completedAt = Date.now();
      await this.persist();
      await this.ledger.append({
        startedAt: job.createdAt,
        completedAt: job.completedAt,
        providerId: p.id,
        providerName: p.name,
        model: args.model,
        kind: "image",
        status,
        reported: !!usage,
        ...usage,
        images: job.images.length,
      });
    }
    return structuredClone(job);
  }
}
module.exports = {
  ImageStudio,
  imageBytes,
  multipart,
  validateRequest,
  explainImageError,
};
