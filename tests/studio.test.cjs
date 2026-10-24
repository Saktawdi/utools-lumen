const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { Core } = require("../runtime/core.cjs");
const { normalizeUsage } = require("../runtime/usage.cjs");
const { createCollector } = require("../runtime/adapters.cjs");
const { explainImageError } = require("../runtime/images.cjs");
const { builtins } = require("../runtime/tools.cjs");
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9kAAAAASUVORK5CYII=";
const settings = {
  providers: [],
  disabledTools: [],
  customTools: [],
  search: { enabled: false },
  toolPermission: "always_allow",
  systemPrompt: "test",
};
function core(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-studio-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new Core({ directory });
}
async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise((resolve) => instance.listen(0, "127.0.0.1", resolve));
  t.after(() => instance.closeAllConnections());
  t.after(() => new Promise((resolve) => instance.close(resolve)));
  return `http://127.0.0.1:${instance.address().port}`;
}
async function raw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
const json = (res, data) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
};
const provider = (baseURL) => ({
  id: "image-test",
  name: "Image test",
  baseURL,
  protocol: "openai-images",
  enabled: true,
  keys: ["private-image-key"],
  models: ["gpt-image-test"],
});
const request = (p) => ({
  id: crypto.randomUUID(),
  provider: p,
  model: p.models[0],
  prompt: "A glass vase",
  size: "1024x1024",
  quality: "low",
  background: "transparent",
  count: 1,
  references: [],
});

test("Images generation persists encrypted outputs, references and usage; gallery changes survive restart", async (t) => {
  let body;
  const url = await server(t, async (req, res) => {
    body = JSON.parse((await raw(req)).toString());
    assert.equal(req.headers.authorization, "Bearer private-image-key");
    assert.equal(req.url, "/v1/images/generations");
    json(res, {
      data: [{ b64_json: png, revised_prompt: "A revised vase" }],
      usage: {
        input_tokens: 32,
        output_tokens: 120,
        input_tokens_details: { cached_tokens: 8 },
      },
    });
  });
  const c = core(t),
    p = provider(url + "/v1");
  const job = await c.imageGenerate(request(p));
  assert.equal(job.status, "done");
  assert.equal(body.background, "transparent");
  assert.equal(body.response_format, undefined);
  assert.equal(job.images[0].revisedPrompt, "A revised vase");
  assert.equal(c.imageAsset(job.images[0].id), "data:image/png;base64," + png);
  const disk = fs.readFileSync(
    path.join(c.store.directory, "image-" + job.images[0].id + ".enc"),
  );
  assert.equal(disk.includes(Buffer.from(png)), false);
  await c.imageFavorite(job.id, true);
  const restart = new Core({ directory: c.store.directory });
  assert.equal(restart.imageJobs()[0].favorite, true);
  const usage = await restart.usage();
  assert.equal(usage.records.length, 1);
  assert.equal(usage.records[0].input, 32);
  assert.equal(usage.records[0].images, 1);
  await restart.imageRemove(job.id);
  assert.equal(restart.imageJobs().length, 0);
  assert.throws(() => restart.imageAsset(job.images[0].id), /不存在/);
  assert.equal((await restart.usage()).records.length, 1);
});

test("OpenAI reference edits use actual multipart image bytes and preserve generation fields", async (t) => {
  let captured, headers;
  const url = await server(t, async (req, res) => {
    captured = await raw(req);
    headers = req.headers;
    assert.equal(req.url, "/v1/images/edits");
    json(res, { data: [{ b64_json: png }] });
  });
  const c = core(t),
    args = request(provider(url + "/v1"));
  args.references = [
    { id: "ref", type: "image", data: "data:image/png;base64," + png },
  ];
  const job = await c.imageGenerate(args);
  assert.equal(job.status, "done");
  assert.match(
    headers["content-type"],
    /multipart\/form-data; boundary=lumen-/,
  );
  assert.ok(captured.includes(Buffer.from(png, "base64")));
  assert.ok(captured.includes(Buffer.from('name="image[]"')));
  assert.ok(captured.includes(Buffer.from('name="prompt"')));
  assert.equal(Number(headers["content-length"]), captured.length);
  assert.equal(job.references.length, 1);
  assert.equal(
    c.imageAsset(job.references[0].id),
    "data:image/png;base64," + png,
  );
});

test("Gemini generates with inline references and aspect ratio, parses mixed text/image output and thought usage", async (t) => {
  let body;
  const url = await server(t, async (req, res) => {
    assert.equal(req.url, "/v1beta/models/gemini-image-test:generateContent");
    assert.equal(req.headers["x-goog-api-key"], "private-image-key");
    body = JSON.parse((await raw(req)).toString());
    json(res, {
      candidates: [
        {
          content: {
            parts: [
              { text: "done" },
              { inlineData: { mimeType: "image/png", data: png } },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 40,
        candidatesTokenCount: 80,
        thoughtsTokenCount: 20,
        cachedContentTokenCount: 10,
      },
    });
  });
  const c = core(t),
    p = {
      ...provider(url + "/v1beta"),
      protocol: "google-images",
      models: ["gemini-image-test"],
    };
  const job = await c.imageGenerate({
    ...request(p),
    size: "16:9",
    quality: "auto",
    background: "auto",
    references: [{ data: "data:image/png;base64," + png }],
  });
  assert.equal(job.status, "done");
  assert.deepEqual(body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
  assert.equal(body.generationConfig.imageConfig.aspectRatio, "16:9");
  assert.equal(body.contents[0].parts[1].inlineData.data, png);
  const row = (await c.usage()).records[0];
  assert.equal(row.input, 40);
  assert.equal(row.output, 100);
  assert.equal(row.reasoning, 20);
});

test("image keys fail over and rotate, URL image downloads never include provider credentials", async (t) => {
  const seen = [];
  const assetUrl = await server(t, (req, res) => {
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers["x-secret"], undefined);
    res.end(Buffer.from(png, "base64"));
  });
  const url = await server(t, async (req, res) => {
    await raw(req);
    seen.push(req.headers.authorization);
    if (req.headers.authorization === "Bearer bad") {
      res.statusCode = 429;
      return json(res, { error: { message: "rate limit" } });
    }
    json(res, { data: [{ url: assetUrl + "/output.png" }] });
  });
  const c = core(t),
    p = {
      ...provider(url),
      keys: ["bad", "good"],
      headers: { "X-Secret": "private-header" },
    };
  assert.equal((await c.imageGenerate(request(p))).status, "done");
  assert.equal((await c.imageGenerate(request(p))).status, "done");
  assert.deepEqual(seen, ["Bearer bad", "Bearer good", "Bearer good"]);
  assert.equal((await c.usage()).records.length, 2);
});

test("cancelling a running image request releases the slot, persists status and reports missing usage honestly", async (t) => {
  let received;
  const started = new Promise((resolve) => (received = resolve));
  const url = await server(t, async (req, res) => {
    await raw(req);
    received();
    if (req.url.includes("generations")) return;
    res.end();
  });
  const c = core(t),
    args = request(provider(url));
  const pending = c.imageGenerate(args);
  await started;
  assert.equal(c.imageJobs()[0].status, "running");
  await assert.rejects(() => c.imageRemove(args.id), /停止/);
  c.imageCancel(args.id);
  const job = await pending;
  assert.equal(job.status, "cancelled");
  assert.equal(c.studio.controllers.size, 0);
  const row = (await c.usage()).records[0];
  assert.equal(row.status, "cancelled");
  assert.equal(row.reported, false);
  assert.equal(row.input, 0);
  assert.equal(
    new Core({ directory: c.store.directory }).imageJobs()[0].status,
    "cancelled",
  );
});

test("image errors are actionable, redact all authentication values and do not invent images", async (t) => {
  const url = await server(t, async (req, res) => {
    await raw(req);
    res.statusCode = 400;
    json(res, {
      error: { message: "invalid private-image-key / image-header-secret" },
    });
  });
  const c = core(t),
    p = { ...provider(url), headers: { "X-Secret": "image-header-secret" } };
  const job = await c.imageGenerate(request(p));
  assert.equal(job.status, "error");
  assert.equal(job.images.length, 0);
  assert.equal(job.error.includes("private-image-key"), false);
  assert.equal(job.error.includes("image-header-secret"), false);
  assert.match(job.error, /HTTP 400/);
  await assert.rejects(
    c.imageGenerate({ ...request(p), size: "file:///secret" }),
    /尺寸/,
  );
  await assert.rejects(
    c.imageGenerate({
      ...request(p),
      references: [{ data: "data:image/svg+xml;base64,abc" }],
    }),
    /参考图/,
  );
});

test("image endpoint mismatch explains gateway routing instead of denying the model type", () => {
  const message = explainImageError(
    new Error(
      'HTTP 400 · images endpoint requires an image model, got "sdxl-lightning"',
    ),
    "sdxl-lightning",
  );
  assert.match(message, /没有把「sdxl-lightning」映射到 Images 生图路由/);
  assert.match(message, /扩散生图模型/);
  assert.equal(
    explainImageError(new Error("HTTP 400 · bad request"), "sdxl-lightning"),
    "HTTP 400 · bad request",
  );
});

test("Agent image generation follows approvals, sends small image IDs upstream and records each model round once", async (t) => {
  let round = 0,
    imageRequests = 0,
    continuation;
  const url = await server(t, async (req, res) => {
    const body = JSON.parse((await raw(req)).toString());
    if (req.url.endsWith("images/generations")) {
      imageRequests++;
      return json(res, {
        data: [{ b64_json: png }],
        usage: { input_tokens: 5, output_tokens: 15 },
      });
    }
    round++;
    if (round === 1)
      return json(res, {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "generate",
                  function: {
                    name: "generate_image",
                    arguments: JSON.stringify({ prompt: "A tiny garden" }),
                  },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 30 },
        },
      });
    continuation = body;
    json(res, {
      choices: [{ message: { content: "Your image is ready." } }],
      usage: { prompt_tokens: 150, completion_tokens: 30 },
    });
  });
  const c = core(t),
    p = provider(url + "/v1"),
    events = [];
  const config = { ...settings, imageProviders: [p], toolPermission: "prompt" };
  await c.chat(
    {
      provider: { ...p, id: "chat-test", protocol: "openai" },
      model: "chat-model",
      config: { tools: true },
      messages: [],
      settings: config,
    },
    (event) => {
      events.push(event);
      if (event.type === "approval") c.approve(event.id, true);
    },
  );
  assert.equal(imageRequests, 1);
  assert.ok(events.some((e) => e.type === "approval"));
  assert.equal(events.find((e) => e.type === "images").images.length, 1);
  const tool = continuation.messages.find((m) => m.role === "tool");
  assert.equal(tool.content.includes(png), false);
  assert.ok(JSON.parse(tool.content).images[0].id);
  const records = (await c.usage()).records;
  assert.equal(records.length, 3);
  assert.equal(
    records.filter((r) => r.kind === "chat").reduce((n, r) => n + r.input, 0),
    250,
  );
  assert.deepEqual(events.filter((e) => e.type === "usage").at(-1).usage, {
    input: 250,
    output: 50,
    cachedInput: 30,
  });
  assert.equal(c.imageJobs()[0].source, "agent");
});

test("denied image tools never contact image API, and unconfigured image tools are disabled", async (t) => {
  assert.equal(
    builtins()
      .list(settings)
      .find((t) => t.name === "generate_image").enabled,
    false,
  );
  let imageRequests = 0,
    round = 0;
  const url = await server(t, async (req, res) => {
    await raw(req);
    if (req.url.includes("images")) {
      imageRequests++;
      return json(res, {});
    }
    round++;
    json(res, {
      choices: [
        {
          message:
            round === 1
              ? {
                  tool_calls: [
                    {
                      id: "denied",
                      function: {
                        name: "generate_image",
                        arguments: '{"prompt":"test"}',
                      },
                    },
                  ],
                }
              : { content: "Permission declined." },
        },
      ],
    });
  });
  const c = core(t),
    p = provider(url);
  await c.chat(
    {
      provider: { ...p, protocol: "openai" },
      model: "chat",
      config: {},
      messages: [],
      settings: { ...settings, toolPermission: "prompt", imageProviders: [p] },
    },
    (event) => {
      if (event.type === "approval") c.approve(event.id, false);
    },
  );
  assert.equal(imageRequests, 0);
  assert.equal(c.imageJobs().length, 0);
});

test("token normalization includes Anthropic cache inputs and preserves cache/reasoning subsets across protocols", () => {
  assert.deepEqual(
    normalizeUsage(
      {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 30,
      },
      "anthropic",
    ),
    { input: 60, output: 5, cachedInput: 20, cacheWrite: 30 },
  );
  for (const [protocol, data] of [
    [
      "openai",
      {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 40 },
          completion_tokens_details: { reasoning_tokens: 20 },
        },
      },
    ],
    [
      "responses",
      {
        type: "response.completed",
        response: {
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            input_tokens_details: { cached_tokens: 40 },
            output_tokens_details: { reasoning_tokens: 20 },
          },
        },
      },
    ],
  ]) {
    const c = createCollector(protocol, () => {});
    c.push(data);
    assert.deepEqual(c.result().usage, {
      input: 100,
      output: 50,
      cachedInput: 40,
      reasoning: 20,
    });
  }
  const anthropic = createCollector("anthropic", () => {});
  anthropic.push({
    message: {
      usage: {
        input_tokens: 10,
        output_tokens: 0,
        cache_read_input_tokens: 20,
      },
    },
  });
  anthropic.push({ usage: { output_tokens: 8 } });
  assert.deepEqual(anthropic.result().usage, {
    input: 30,
    output: 8,
    cachedInput: 20,
  });
});

test("legacy usage is seeded once and survives conversation deletion without recounting", async (t) => {
  const c = core(t);
  await c.save({
    settings: { providers: [{ id: "p", name: "Saved provider" }] },
    conversations: [
      {
        id: "c",
        modelKey: "p::model",
        messages: [
          {
            id: "m",
            role: "assistant",
            createdAt: Date.now() - 100,
            model: "old",
            usage: { input: 12, output: 8 },
          },
        ],
      },
    ],
  });
  assert.equal((await c.usage()).records.length, 1);
  assert.equal((await c.usage()).records[0].legacy, true);
  await c.save({ settings: { providers: [] }, conversations: [] });
  const restarted = new Core({ directory: c.store.directory });
  assert.equal((await restarted.usage()).records.length, 1);
});

test("model-specific constraints reject unsupported paid requests before contacting the API", async (t) => {
  const c = core(t),
    p = provider("http://127.0.0.1:1/v1");
  const base = {
    ...request(p),
    model: "dall-e-3",
    quality: "auto",
    background: "auto",
  };
  await assert.rejects(c.imageGenerate({ ...base, count: 2 }), /最多生成 1/);
  await assert.rejects(
    c.imageGenerate({
      ...base,
      references: [{ data: "data:image/png;base64," + png }],
    }),
    /不支持参考图/,
  );
  await assert.rejects(c.imageGenerate({ ...base, size: "1536x1024" }), /尺寸/);
  await assert.rejects(
    c.imageGenerate({ ...request(p), quality: "max" }),
    /质量/,
  );
  await assert.rejects(
    c.imageGenerate({ ...request(p), size: "16:9" }),
    /像素尺寸/,
  );
  const rectangular = Buffer.from(png, "base64");
  rectangular.writeUInt32BE(2, 16);
  await assert.rejects(
    c.imageGenerate({
      ...base,
      model: "dall-e-2",
      references: [
        { data: "data:image/png;base64," + rectangular.toString("base64") },
      ],
    }),
    /方形 PNG/,
  );
  assert.equal(c.imageJobs().length, 0);
});

test("encrypted thumbnails never replace originals and deletion removes both variants", async (t) => {
  const url = await server(t, async (req, res) => {
    await raw(req);
    json(res, { data: [{ b64_json: png }] });
  });
  const c = core(t),
    job = await c.imageGenerate(request(provider(url))),
    asset = job.images[0];
  await c.imageThumbnail(asset.id, "data:image/png;base64," + png);
  assert.equal(c.imageAsset(asset.id, true), "data:image/png;base64," + png);
  assert.equal(c.imageAsset(asset.id), "data:image/png;base64," + png);
  assert.ok(
    fs.existsSync(
      path.join(c.store.directory, "image-" + asset.id + "-thumb.enc"),
    ),
  );
  await c.imageRemove(job.id);
  await assert.rejects(
    c.imageThumbnail(asset.id, "data:image/png;base64," + png),
    /不存在/,
  );
  assert.throws(() => c.imageAsset(asset.id, true), /不存在/);
  assert.equal(
    fs.existsSync(
      path.join(c.store.directory, "image-" + asset.id + "-thumb.enc"),
    ),
    false,
  );
});

test("an interrupted stream preserves any usage already reported by the upstream", async (t) => {
  let emitted;
  const ready = new Promise((resolve) => (emitted = resolve));
  const url = await server(t, async (req, res) => {
    await raw(req);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      'data: {"choices":[{"delta":{"content":"partial"}}],"usage":{"prompt_tokens":80,"completion_tokens":12}}\n\n',
    );
    emitted();
  });
  const c = core(t),
    p = { ...provider(url), protocol: "openai" },
    events = [];
  let sawText;
  const parsed = new Promise((resolve) => (sawText = resolve));
  const pending = c.chat(
    {
      provider: p,
      model: "chat",
      config: { tools: false },
      settings,
      messages: [],
    },
    (event) => {
      events.push(event);
      if (event.type === "text") sawText();
    },
  );
  await ready;
  await parsed;
  c.stop();
  await pending;
  const usage = (await c.usage()).records[0];
  assert.equal(usage.status, "cancelled");
  assert.equal(usage.reported, true);
  assert.equal(usage.input, 80);
  assert.equal(usage.output, 12);
  assert.equal(events.find((e) => e.type === "usage").usage.input, 80);
});
