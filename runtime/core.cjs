const crypto = require("node:crypto");
const { request, assertOk, sse } = require("./transport.cjs");
const {
  buildRequest,
  authHeaders,
  createCollector,
  endpoint,
} = require("./adapters.cjs");
const { webSearch, withKeys } = require("./search.cjs");
const { builtins, addCustom } = require("./tools.cjs");
const { LocalStore } = require("./storage.cjs");
const { flattenCatalog } = require("./catalog.cjs");
function cleanError(error, settings) {
  let text =
    error?.name === "AbortError"
      ? "已停止生成"
      : String(error?.message || error);
  for (const key of [
    ...(settings?.providers || []).flatMap((p) => p.keys || []),
    ...(settings?.providers || []).flatMap((p) =>
      Object.values(p.headers || {}),
    ),
    ...(settings?.search?.keys || []),
    ...(settings?.customTools || []).flatMap((t) =>
      Object.values(t.headers || {}),
    ),
  ])
    if (key) text = text.split(key).join("[密钥已隐藏]");
  return text;
}
function wireMessages(messages, systemPrompt) {
  return [
    { role: "system", content: systemPrompt },
    ...messages
      .filter((m) => !m.error)
      .map((m) => ({
        role: m.role,
        content:
          m.content +
          (m.attachments || [])
            .filter((x) => x.type === "text")
            .map(
              (a) =>
                `\n\n<user_attachment id="${a.id}" name=${JSON.stringify(a.name)}>\n${a.data.slice(0, 24000)}\n</user_attachment>`,
            )
            .join(""),
        images: (m.attachments || [])
          .filter((x) => x.type === "image")
          .map((x) => x.data),
      })),
  ];
}
class Core {
  constructor(options = {}) {
    this.store = options.store || new LocalStore(options.directory);
    this.controller = null;
    this.approvals = new Map();
    this.toolPermission = "prompt";
    this.extraTools = [];
    this.catalogPromise = null;
  }
  load() {
    return this.store.read("state", null);
  }
  async save(state) {
    if (
      !state ||
      !state.settings ||
      !Array.isArray(state.conversations) ||
      !Array.isArray(state.settings.providers)
    )
      throw new Error("保存数据格式无效");
    await this.store.write("state", state);
  }
  registerTool(tool) {
    this.registry().register(tool);
    this.extraTools.push(tool);
    return () => {
      this.extraTools = this.extraTools.filter((x) => x !== tool);
    };
  }
  registry(settings = {}) {
    const registry = builtins();
    for (const tool of this.extraTools) registry.register(tool);
    for (const tool of settings.customTools || []) addCustom(registry, tool);
    return registry;
  }
  tools(settings) {
    return this.registry(settings).list(settings);
  }
  async models(provider) {
    try {
      return await withKeys(
        "provider:" + provider.id,
        provider.keys,
        async (key) => {
          const root = provider.baseURL.replace(/\/+$/, "");
          const url =
            provider.protocol === "google"
              ? root + "/models?pageSize=1000"
              : endpoint(root, "models");
          const headers = {
            ...authHeaders(provider, key),
            ...provider.headers,
            ...(provider.protocol === "anthropic"
              ? { "anthropic-version": "2023-06-01" }
              : {}),
          };
          let next = url,
            all = [];
          for (let page = 0; page < 10 && next; page++) {
            const data = await (
              await assertOk(await request(next, { headers }))
            ).json();
            if (data.error)
              throw new Error(data.error.message || "无法拉取模型");
            const list = data.data || data.models || data;
            if (!Array.isArray(list)) throw new Error("模型接口未返回有效列表");
            all.push(
              ...list
                .map((m) =>
                  typeof m === "string"
                    ? m
                    : m.id || m.name?.replace(/^models\//, ""),
                )
                .filter(Boolean),
            );
            if (data.nextPageToken) {
              const u = new URL(url);
              u.searchParams.set("pageToken", data.nextPageToken);
              next = u.toString();
            } else if (data.has_more && data.last_id) {
              const u = new URL(url);
              u.searchParams.set("after_id", data.last_id);
              next = u.toString();
            } else next = null;
          }
          return [...new Set(all)].sort((a, b) => a.localeCompare(b));
        },
      );
    } catch (e) {
      throw new Error(cleanError(e, { providers: [provider] }));
    }
  }
  async catalog(force = false) {
    const saved = this.store.read("catalog", null);
    if (!force && saved && Date.now() - saved.at < 3600000)
      return saved.entries;
    if (this.catalogPromise) return this.catalogPromise;
    this.catalogPromise = (async () => {
      try {
        const data = await (
          await assertOk(await request("https://models.dev/api.json"))
        ).json();
        const entries = flattenCatalog(data);
        await this.store.write("catalog", { at: Date.now(), entries });
        return entries;
      } catch (e) {
        if (saved) return saved.entries;
        throw e;
      } finally {
        this.catalogPromise = null;
      }
    })();
    return this.catalogPromise;
  }
  async searchTest(config, query) {
    try {
      return await webSearch(config, query);
    } catch (e) {
      throw new Error(cleanError(e, { search: config }));
    }
  }
  stop() {
    this.controller?.abort();
    for (const id of this.approvals.keys()) this.approve(id, false);
  }
  approve(id, allow) {
    const approval = this.approvals.get(id);
    if (!approval) return;
    this.approvals.delete(id);
    approval.resolve(allow === true);
    approval.onEvent({ type: "approval-resolved", id });
  }
  setToolPermission(mode) {
    if (mode !== "prompt" && mode !== "always_allow")
      throw new Error("工具权限模式无效");
    this.toolPermission = mode;
    if (mode === "always_allow")
      for (const id of this.approvals.keys()) this.approve(id, true);
  }
  async chat(args, onEvent) {
    if (this.controller) throw new Error("已有请求正在运行");
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    const { provider, model, config, settings } = args;
    this.toolPermission =
      settings.toolPermission === "always_allow" ? "always_allow" : "prompt";
    try {
      const registry = this.registry(settings);
      const definitions = registry
        .list(settings)
        .filter(
          (t) =>
            t.enabled && (t.name !== "web_search" || settings.search.enabled),
        );
      const tools = config.tools === false ? [] : definitions;
      const messages = wireMessages(args.messages, settings.systemPrompt);
      const attachments = args.messages.flatMap((m) => m.attachments || []);
      const effective =
        args.effort && args.effort !== "auto"
          ? args.effort
          : provider.defaultEffort;
      let totalUsage = { input: 0, output: 0 };
      for (let step = 0; step < 8; step++) {
        signal.throwIfAborted();
        const built = buildRequest(
          provider,
          model,
          messages,
          tools,
          effective,
          config,
        );
        const response = await withKeys(
          "provider:" + provider.id,
          provider.keys,
          async (key) =>
            assertOk(
              await request(built.url, {
                method: "POST",
                headers: { ...authHeaders(provider, key), ...built.headers },
                body: built.body,
                signal,
              }),
            ),
        );
        const collector = createCollector(provider.protocol, onEvent);
        if (
          String(response.headers["content-type"]).includes("text/event-stream")
        )
          for await (const item of sse(response.body)) {
            signal.throwIfAborted();
            collector.push(item.data, item.event);
          }
        else {
          const data = await response.json();
          if (data.error) collector.push(data);
          if (provider.protocol === "responses") {
            for (const item of data.output || []) {
              if (item.type === "message")
                for (const c of item.content || [])
                  collector.push({
                    type: "response.output_text.delta",
                    delta: c.text,
                  });
              if (item.type === "function_call")
                collector.push({
                  type: "response.output_item.added",
                  output_index: data.output.indexOf(item),
                  item,
                });
              collector.push({
                type: "response.output_item.done",
                output_index: data.output.indexOf(item),
                item,
              });
            }
            collector.push({ type: "response.completed", response: data });
          } else if (provider.protocol === "anthropic") {
            for (const [index, b] of (data.content || []).entries())
              collector.push({
                type: "content_block_start",
                index,
                content_block: b,
              });
            collector.push({ message: { usage: data.usage } });
          } else if (Array.isArray(data)) {
            for (const chunk of data) collector.push(chunk);
          } else collector.push(data);
        }
        const result = collector.result();
        if (result.usage) {
          totalUsage.input += result.usage.input;
          totalUsage.output += result.usage.output;
          onEvent({ type: "usage", usage: totalUsage });
        }
        if (!result.calls.length) {
          if (!result.text && !result.reasoning)
            throw new Error("模型返回了空响应，请检查模型协议或额度");
          onEvent({ type: "done" });
          return;
        }
        messages.push({
          role: "assistant",
          content: result.text,
          tool_calls: result.calls,
          nativeAnthropic: result.nativeAnthropic,
          nativeResponses: result.nativeResponses,
          nativeGoogle: result.nativeGoogle,
        });
        for (const call of result.calls) {
          signal.throwIfAborted();
          const start = Date.now();
          const running = { ...call, status: "running" };
          onEvent({ type: "tool", call: running });
          let value,
            status = "done";
          try {
            const params = JSON.parse(call.arguments);
            value = await registry.execute(call.name, params, {
              settings,
              signal,
              attachments,
              approve: (name, args) => {
                if (this.toolPermission === "always_allow")
                  return Promise.resolve(!signal.aborted);
                return new Promise((resolve) => {
                  const id = crypto.randomUUID();
                  this.approvals.set(id, { resolve, onEvent });
                  onEvent({ type: "approval", id, name, args });
                });
              },
            });
            signal.throwIfAborted();
          } catch (e) {
            if (signal.aborted) throw e;
            status = "error";
            value = { error: cleanError(e, settings) };
          }
          const rendered = JSON.stringify(value) ?? "null";
          onEvent({
            type: "tool-result",
            call: {
              ...call,
              status,
              result: value,
              duration: Date.now() - start,
            },
          });
          messages.push({
            role: "tool",
            content: rendered.slice(0, 50000),
            tool_call_id: call.id,
            tool_name: call.name,
          });
        }
      }
      throw new Error(
        "本次已执行 8 轮工具调用。你可以继续追问，以便完成后续步骤。",
      );
    } catch (error) {
      if (signal.aborted) {
        onEvent({ type: "done", text: "stopped" });
        return;
      }
      throw new Error(cleanError(error, settings));
    } finally {
      this.controller = null;
      for (const id of this.approvals.keys()) this.approve(id, false);
    }
  }
}
module.exports = { Core, wireMessages, cleanError };
