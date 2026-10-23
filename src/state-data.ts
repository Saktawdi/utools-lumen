import { freshState, newProvider } from "./defaults";
import type {
  AppState,
  Conversation,
  CustomTool,
  ModelConfig,
  Provider,
  Settings,
  Skin,
} from "./types";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string"))
    throw new Error(`${label} 必须是字符串数组`);
  return [...new Set(value.map((x) => x.trim()).filter(Boolean))];
}
function httpURL(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} 格式无效`);
  if (!value.trim()) return "";
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(`${label} 需要 HTTP / HTTPS 地址`);
  return value.trim();
}
function headers(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!object(value) || Object.values(value).some((v) => typeof v !== "string"))
    throw new Error("请求头必须是字符串键值对象");
  return Object.fromEntries(Object.entries(value)) as Record<string, string>;
}
export function parseSkin(value: unknown): Skin {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string" ||
    !value.name
  )
    throw new Error("皮肤需要 id 和 name");
  const color = (key: string, required = false) => {
    const v = value[key];
    if (v === undefined && !required) return undefined;
    if (typeof v !== "string" || !/^#[a-f\d]{6}$/i.test(v))
      throw new Error("皮肤颜色需要使用 #RRGGBB");
    return v;
  };
  return {
    id: value.id,
    name: value.name,
    description: String(value.description || ""),
    accent: color("accent", true)!,
    darkAccent: color("darkAccent", true)!,
    background: color("background"),
    darkBackground: color("darkBackground"),
  };
}
function modelConfigs(value: unknown): Record<string, ModelConfig> {
  if (value === undefined) return {};
  if (!object(value)) throw new Error("模型配置必须是对象");
  return Object.fromEntries(
    Object.entries(value).map(([id, raw]) => {
      if (!object(raw)) throw new Error(`模型 ${id} 的配置无效`);
      const next: ModelConfig = {};
      for (const key of ["vision", "reasoning", "tools"] as const) {
        if (raw[key] !== undefined && typeof raw[key] !== "boolean")
          throw new Error(`模型 ${id} 的 ${key} 配置无效`);
        if (typeof raw[key] === "boolean") next[key] = raw[key];
      }
      for (const key of [
        "context",
        "output",
        "maxTokens",
        "temperature",
      ] as const) {
        if (
          raw[key] !== undefined &&
          (typeof raw[key] !== "number" || !Number.isFinite(raw[key]))
        )
          throw new Error(`模型 ${id} 的数值配置无效`);
        if (typeof raw[key] === "number") next[key] = raw[key];
      }
      if (raw.levels !== undefined)
        next.levels = strings(raw.levels, "推理档位");
      for (const key of ["source", "matchedId"] as const)
        if (typeof raw[key] === "string") next[key] = raw[key];
      if (["effort", "toggle", "budget"].includes(String(raw.reasoningMode)))
        next.reasoningMode = raw.reasoningMode as ModelConfig["reasoningMode"];
      return [id, next];
    }),
  );
}
export function parseProvider(value: unknown): Provider {
  if (!object(value)) throw new Error("供应商条目必须是对象");
  const base = newProvider();
  const protocol = value.protocol ?? "openai";
  if (
    !["openai", "responses", "anthropic", "google"].includes(String(protocol))
  )
    throw new Error("不支持的供应商协议");
  return {
    id: typeof value.id === "string" && value.id ? value.id : base.id,
    name:
      typeof value.name === "string" && value.name
        ? value.name
        : "导入的供应商",
    baseURL: httpURL(value.baseURL ?? value.url ?? "", "供应商地址"),
    protocol: protocol as Provider["protocol"],
    keys:
      value.keys !== undefined
        ? strings(value.keys, "密钥")
        : typeof value.apiKey === "string"
          ? [value.apiKey].filter(Boolean)
          : [],
    models: strings(value.models ?? [], "启动模型"),
    availableModels: strings(value.availableModels ?? [], "可用模型"),
    modelConfigs: modelConfigs(value.modelConfigs),
    enabled: value.enabled !== false,
    defaultEffort:
      typeof value.defaultEffort === "string" ? value.defaultEffort : "auto",
    headers: headers(value.headers),
  };
}
export function parseCustomTool(value: unknown): CustomTool {
  if (
    !object(value) ||
    typeof value.name !== "string" ||
    !/^[a-zA-Z][\w-]{0,63}$/.test(value.name) ||
    typeof value.title !== "string" ||
    !value.title ||
    typeof value.description !== "string" ||
    !value.description ||
    !object(value.inputSchema) ||
    value.inputSchema.type !== "object" ||
    !["GET", "POST"].includes(String(value.method))
  )
    throw new Error("请检查工具名称、说明、method 和 inputSchema");
  const endpoint = httpURL(value.endpoint, "工具地址");
  if (!endpoint) throw new Error("需要填写工具地址");
  return {
    name: value.name,
    title: value.title,
    description: value.description,
    group: typeof value.group === "string" ? value.group : "扩展工具",
    inputSchema: value.inputSchema,
    method: value.method as "GET" | "POST",
    endpoint,
    headers: headers(value.headers),
  };
}
export function mergeState(raw: AppState | null): AppState {
  const initial = freshState();
  if (!raw) return initial;
  const settings: Settings = {
    ...initial.settings,
    ...raw.settings,
    toolPermission:
      raw.settings?.toolPermission === "always_allow"
        ? "always_allow"
        : "prompt",
    search: { ...initial.settings.search, ...raw.settings?.search },
    skins: raw.settings?.skins?.length
      ? raw.settings.skins
      : initial.settings.skins,
  };
  return {
    ...initial,
    ...raw,
    settings,
    conversations: raw.conversations || [],
  };
}
export function exportBackup(state: AppState, includeKeys: boolean) {
  // Reconstruct providers and tools so unknown fields from imported files cannot hide credentials.
  const safe = structuredClone(state);
  safe.settings.providers = state.settings.providers.map(parseProvider);
  safe.settings.customTools = state.settings.customTools.map(parseCustomTool);
  if (!includeKeys) {
    for (const p of safe.settings.providers) {
      p.keys = [];
      p.headers = {};
    }
    safe.settings.search.keys = [];
    for (const t of safe.settings.customTools) t.headers = {};
  }
  return {
    ...safe,
    format: "lumen-backup",
    version: 1,
    secretsIncluded: includeKeys,
  };
}
export function importBackup(
  raw: unknown,
  current: AppState,
): { state: AppState; count: number } {
  const data = object(raw) ? raw : {};
  const imported = object(data.settings) ? data.settings : {};
  const source = Array.isArray(raw)
    ? raw
    : (imported.providers ?? data.providers);
  if (!Array.isArray(source))
    throw new Error("JSON 需要包含 providers 数组或 Lumen 备份");
  const providers = new Map(current.settings.providers.map((p) => [p.id, p]));
  for (const item of source) {
    const p = parseProvider(item);
    const old = providers.get(p.id);
    if (data.secretsIncluded === false && old) {
      p.keys = old.keys;
      p.headers = old.headers;
    }
    providers.set(p.id, p);
  }
  const patch: Partial<Settings> = {};
  if (imported.toolPermission !== undefined) {
    if (!["prompt", "always_allow"].includes(String(imported.toolPermission)))
      throw new Error("工具权限模式无效");
    patch.toolPermission =
      imported.toolPermission as Settings["toolPermission"];
  }
  if (imported.theme !== undefined) {
    if (!["light", "dark", "system"].includes(String(imported.theme)))
      throw new Error("显示模式无效");
    patch.theme = imported.theme as Settings["theme"];
  }
  for (const key of ["compact", "reduceMotion"] as const)
    if (typeof imported[key] === "boolean") patch[key] = imported[key];
  for (const key of [
    "skin",
    "systemPrompt",
    "defaultModel",
    "translationLanguage",
  ] as const)
    if (typeof imported[key] === "string") patch[key] = imported[key];
  if (["enter", "ctrl-enter"].includes(String(imported.sendKey)))
    patch.sendKey = imported.sendKey as Settings["sendKey"];
  if (imported.skins !== undefined) {
    if (!Array.isArray(imported.skins) || !imported.skins.length)
      throw new Error("皮肤列表不能为空");
    patch.skins = imported.skins.map(parseSkin);
  }
  if (imported.disabledTools !== undefined)
    patch.disabledTools = strings(imported.disabledTools, "工具开关").filter(
      (x) => x !== "list_tools",
    );
  if (imported.customTools !== undefined) {
    if (!Array.isArray(imported.customTools))
      throw new Error("工具列表格式无效");
    patch.customTools = imported.customTools.map(parseCustomTool);
    const names = patch.customTools.map((t) => t.name);
    if (
      new Set(names).size !== names.length ||
      names.some((n) =>
        [
          "list_tools",
          "current_time",
          "calculate",
          "web_search",
          "fetch_url",
          "list_attachments",
          "read_attachment",
        ].includes(n),
      )
    )
      throw new Error("工具名称重复或使用了内置工具名");
    if (data.secretsIncluded === false)
      patch.customTools = patch.customTools.map((t) => ({
        ...t,
        headers:
          current.settings.customTools.find((old) => old.name === t.name)
            ?.headers || {},
      }));
  }
  if (imported.search !== undefined) {
    const s = imported.search;
    if (
      !object(s) ||
      !["anysearch", "tavily", "searxng", "custom"].includes(String(s.engine))
    )
      throw new Error("搜索配置无效");
    if (!["bearer", "x-api-key", "body"].includes(String(s.keyMode)))
      throw new Error("搜索密钥传递方式无效");
    patch.search = {
      engine: s.engine as Settings["search"]["engine"],
      endpoint: httpURL(s.endpoint, "搜索地址"),
      keyMode: s.keyMode as Settings["search"]["keyMode"],
      keys:
        data.secretsIncluded === false
          ? current.settings.search.keys
          : strings(s.keys ?? [], "搜索密钥"),
      enabled: s.enabled === true,
      limit: Math.max(1, Math.min(10, Number(s.limit) || 5)),
    };
  }
  const conversations = new Map(current.conversations.map((c) => [c.id, c]));
  if (data.conversations !== undefined) {
    if (!Array.isArray(data.conversations)) throw new Error("对话列表格式无效");
    for (const c of data.conversations) {
      if (
        !object(c) ||
        typeof c.id !== "string" ||
        typeof c.title !== "string" ||
        !Array.isArray(c.messages)
      )
        throw new Error("对话条目格式无效");
      for (const m of c.messages) {
        if (
          !object(m) ||
          !["user", "assistant"].includes(String(m.role)) ||
          typeof m.content !== "string" ||
          typeof m.id !== "string"
        )
          throw new Error("对话消息格式无效");
        if (
          m.attachments !== undefined &&
          (!Array.isArray(m.attachments) ||
            m.attachments.some(
              (a) =>
                !object(a) ||
                !["image", "text"].includes(String(a.type)) ||
                typeof a.data !== "string" ||
                typeof a.name !== "string" ||
                typeof a.id !== "string",
            ))
        )
          throw new Error("附件格式无效");
        if (
          m.tools !== undefined &&
          (!Array.isArray(m.tools) ||
            m.tools.some(
              (t) =>
                !object(t) ||
                typeof t.name !== "string" ||
                typeof t.arguments !== "string",
            ))
        )
          throw new Error("工具记录格式无效");
        if (
          m.usage !== undefined &&
          (!object(m.usage) ||
            typeof m.usage.input !== "number" ||
            typeof m.usage.output !== "number")
        )
          throw new Error("用量记录格式无效");
      }
      conversations.set(c.id, c as unknown as Conversation);
    }
  }
  const state = mergeState({
    ...current,
    settings: {
      ...current.settings,
      ...patch,
      providers: [...providers.values()],
    },
    conversations: [...conversations.values()],
  });
  return { state, count: source.length };
}
