const { request, assertOk } = require("./transport.cjs");
const { webSearch } = require("./search.cjs");
class ToolRegistry {
  constructor() {
    this.entries = new Map();
  }
  register(tool) {
    if (!/^[a-zA-Z][\w-]{0,63}$/.test(tool.name))
      throw new Error("工具名必须为 1–64 位字母、数字、下划线或短横线");
    if (this.entries.has(tool.name))
      throw new Error("工具名已存在：" + tool.name);
    if (typeof tool.execute !== "function")
      throw new Error("工具需要 execute 函数");
    if (tool.inputSchema?.type !== "object")
      throw new Error("工具 inputSchema.type 必须为 object");
    this.entries.set(tool.name, tool);
    return () => this.entries.delete(tool.name);
  }
  list(settings = {}) {
    return [...this.entries.values()].map(({ execute, headers, ...tool }) => ({
      ...tool,
      enabled:
        tool.name === "list_tools" ||
        (!(settings.disabledTools || []).includes(tool.name) &&
          (tool.name !== "web_search" || !!settings.search?.enabled)),
    }));
  }
  async execute(name, args, context) {
    const tool = this.entries.get(name);
    if (!tool) throw new Error("未注册工具：" + name);
    if (name !== "list_tools" && context.settings.disabledTools?.includes(name))
      throw new Error("该工具已关闭");
    validateArgs(args, tool.inputSchema);
    if (tool.approval && !(await context.approve(name, args)))
      return {
        denied: true,
        message: "用户拒绝了此次执行。请如实告知，不要更换参数或工具绕过拒绝。",
      };
    context.signal?.throwIfAborted();
    return tool.execute(args, context);
  }
}
function validateArgs(value, schema) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("工具参数必须为对象");
  for (const key of schema.required || [])
    if (value[key] === undefined) throw new Error("缺少工具参数：" + key);
  for (const [key, rule] of Object.entries(schema.properties || {})) {
    const v = value[key];
    if (v === undefined) continue;
    if (
      (rule.type === "string" && typeof v !== "string") ||
      (rule.type === "number" && typeof v !== "number") ||
      (rule.type === "integer" && !Number.isInteger(v)) ||
      (rule.type === "boolean" && typeof v !== "boolean") ||
      (rule.type === "object" &&
        (!v || typeof v !== "object" || Array.isArray(v))) ||
      (rule.type === "array" && !Array.isArray(v))
    )
      throw new Error("工具参数类型错误：" + key);
    if (rule.enum && !rule.enum.includes(v))
      throw new Error("工具参数不在允许范围：" + key);
    if (typeof v === "string" && v.length > 100000)
      throw new Error("工具参数过长");
  }
  if (schema.additionalProperties === false)
    for (const key of Object.keys(value))
      if (!schema.properties?.[key]) throw new Error("未知工具参数：" + key);
}
function calculate(expression) {
  const source = String(expression).replace(/\s+/g, "");
  if (source.length > 500 || !/^[\d.eE+\-*/%()]+$/.test(source))
    throw new Error("仅支持数字、括号和 + - * / % 运算");
  const tokens =
    source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[()+\-*/%]/g) || [];
  if (tokens.join("") !== source) throw new Error("算式格式无效");
  let i = 0;
  const atom = () => {
    const t = tokens[i++];
    if (t === "(") {
      const value = add();
      if (tokens[i++] !== ")") throw new Error("括号不匹配");
      return value;
    }
    if (t === "-") return -atom();
    if (t === "+") return atom();
    if (t === undefined || !/^\d|^\./.test(t)) throw new Error("算式格式无效");
    return Number(t);
  };
  const mul = () => {
    let v = atom();
    while (["*", "/", "%"].includes(tokens[i])) {
      const op = tokens[i++],
        n = atom();
      v = op === "*" ? v * n : op === "/" ? v / n : v % n;
    }
    return v;
  };
  const add = () => {
    let v = mul();
    while (["+", "-"].includes(tokens[i])) {
      const op = tokens[i++],
        n = mul();
      v = op === "+" ? v + n : v - n;
    }
    return v;
  };
  const result = add();
  if (i !== tokens.length || !Number.isFinite(result))
    throw new Error("算式无效或结果不是有限数值");
  return result;
}
function builtins() {
  const registry = new ToolRegistry();
  const register = (tool) => registry.register(tool);
  const schema = (properties) => ({
    type: "object",
    properties,
    additionalProperties: false,
  });
  register({
    name: "list_tools",
    title: "发现工具",
    description: "列出所有已注册的工具、参数及开关状态。",
    group: "基础能力",
    inputSchema: schema({}),
    execute: (_, { settings }) => registry.list(settings),
  });
  register({
    name: "current_time",
    title: "当前时间",
    description: "获取指定时区的当前日期和时间。",
    group: "基础能力",
    inputSchema: schema({
      timezone: { type: "string", description: "IANA 时区，例如 Asia/Tokyo" },
    }),
    execute: ({ timezone = "Asia/Tokyo" }) => ({
      time: new Date().toLocaleString("zh-CN", {
        timeZone: timezone,
        hour12: false,
      }),
      timezone,
      iso: new Date().toISOString(),
    }),
  });
  register({
    name: "calculate",
    title: "精确计算",
    description: "计算数学表达式，支持括号与加减乘除、余数。",
    group: "基础能力",
    inputSchema: {
      ...schema({ expression: { type: "string" } }),
      required: ["expression"],
    },
    execute: ({ expression }) => ({
      expression,
      result: calculate(expression),
    }),
  });
  register({
    name: "web_search",
    title: "网页搜索",
    description: "搜索实时网页信息，返回内容与来源。",
    group: "联网检索",
    inputSchema: {
      ...schema({ query: { type: "string", description: "明确的搜索词" } }),
      required: ["query"],
    },
    execute: ({ query }, { settings, signal }) => {
      if (!settings.search.enabled) throw new Error("请先在设置中启用网页搜索");
      return webSearch(settings.search, query, signal);
    },
  });
  register({
    name: "fetch_url",
    title: "读取网页",
    description: "读取用户或搜索结果提供的 HTTP / HTTPS 网页内容。",
    group: "联网检索",
    approval: true,
    inputSchema: { ...schema({ url: { type: "string" } }), required: ["url"] },
    execute: async ({ url }, { signal }) => {
      const r = await assertOk(
        await request(url, {
          signal,
          headers: { Accept: "text/html, text/plain" },
        }),
      );
      const text = await r.text(3 * 1024 * 1024);
      return {
        url,
        text: text
          .replace(
            /<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,
            "",
          )
          .replace(/<[^>]+>/g, " ")
          .replace(/[ \t]+/g, " ")
          .slice(0, 40000),
      };
    },
  });
  register({
    name: "list_attachments",
    title: "列出附件",
    description: "列出当前会话中用户提供的文件附件。",
    group: "文件与附件",
    inputSchema: schema({}),
    execute: (_, { attachments }) =>
      attachments.map(({ id, name, type, size }) => ({ id, name, type, size })),
  });
  register({
    name: "read_attachment",
    title: "读取附件",
    description: "按附件 ID 读取用户提供的文本文件内容。图片通过视觉消息读取。",
    group: "文件与附件",
    inputSchema: {
      ...schema({
        id: { type: "string" },
        offset: { type: "integer" },
        length: { type: "integer" },
      }),
      required: ["id"],
    },
    execute: ({ id, offset = 0, length = 16000 }, { attachments }) => {
      const item = attachments.find((x) => x.id === id);
      if (!item) throw new Error("找不到附件");
      if (item.type !== "text") throw new Error("图片已作为视觉消息传给模型");
      return {
        name: item.name,
        total: item.data.length,
        text: item.data.slice(
          Math.max(0, offset),
          Math.max(0, offset) + Math.min(50000, Math.max(1, length)),
        ),
      };
    },
  });
  return registry;
}
function addCustom(registry, tool) {
  registry.register({
    ...tool,
    custom: true,
    approval: true,
    execute: async (args, { signal }) => {
      const url = new URL(tool.endpoint);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("扩展工具地址无效");
      if (tool.method === "GET")
        for (const [k, v] of Object.entries(args))
          url.searchParams.set(
            k,
            typeof v === "object" ? JSON.stringify(v) : String(v),
          );
      const response = await assertOk(
        await request(url.toString(), {
          method: tool.method,
          body: tool.method === "GET" ? undefined : args,
          headers: tool.headers,
          signal,
        }),
      );
      const data = await response.text(2 * 1024 * 1024);
      try {
        return JSON.parse(data);
      } catch {
        return data;
      }
    },
  });
}
module.exports = { ToolRegistry, builtins, addCustom, calculate, validateArgs };
