import { useMemo, useRef, useState } from "react";
import {
  Check,
  CloudDownload,
  ImagePlus,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { bridge } from "./bridge";
import type { ImageProvider, Settings } from "./types";
import { Field, IconButton, KeysEditor, Toggle, cx } from "./ui";

export default function ImageSettings({
  settings,
  update,
  notify,
}: {
  settings: Settings;
  update: (
    patch: Partial<Settings> | ((current: Settings) => Partial<Settings>),
  ) => void;
  notify: (text: string) => void;
}) {
  const [selected, setSelected] = useState(
    settings.imageProviders[0]?.id || "",
  );
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const filterInput = useRef<HTMLInputElement>(null);
  const [manual, setManual] = useState("");
  const [deleting, setDeleting] = useState(false);
  const p =
    settings.imageProviders.find((p) => p.id === selected) ||
    settings.imageProviders[0];
  const patch = (value: Partial<ImageProvider>) =>
    update((current) => ({
      imageProviders: current.imageProviders.map((item) =>
        item.id === p?.id ? { ...item, ...value } : item,
      ),
    }));
  const all = useMemo(
    () => [...new Set([...(p?.models || []), ...(p?.availableModels || [])])],
    [p],
  );
  const filtered = useMemo(
    () => all.filter((m) => m.toLowerCase().includes(query.toLowerCase())),
    [all, query],
  );
  const add = (protocol: ImageProvider["protocol"]) => {
    const provider: ImageProvider = {
      id: crypto.randomUUID(),
      name: protocol === "openai-images" ? "OpenAI Images" : "Gemini 生图",
      protocol,
      baseURL:
        protocol === "openai-images"
          ? "https://api.openai.com/v1"
          : "https://generativelanguage.googleapis.com/v1beta",
      keys: [],
      models: [],
      availableModels: [],
      enabled: true,
    };
    update({ imageProviders: [...settings.imageProviders, provider] });
    setSelected(provider.id);
    setDeleting(false);
  };
  const toggle = (model: string) =>
    patch({
      models: p.models.includes(model)
        ? p.models.filter((m) => m !== model)
        : [...p.models, model],
    });
  return (
    <div className="image-provider-settings">
      <div className="row between wrap gap">
        <p className="section-description">
          独立连接生图模型，供工作室和 Agent 使用。
        </p>
        <span className="count-badge">
          {settings.imageProviders.length} 个供应商
        </span>
      </div>
      <div className="provider-list image-provider-list">
        {settings.imageProviders.map((item) => (
          <button
            key={item.id}
            className={cx("provider-card", p?.id === item.id && "active")}
            onClick={() => {
              setSelected(item.id);
              setDeleting(false);
              setQuery("");
            }}
          >
            <span className="provider-avatar">
              <ImagePlus size={16} />
            </span>
            <span>
              <strong>{item.name}</strong>
              <small>{item.models.length} 个生图模型</small>
            </span>
            <i className={cx("status-dot", item.enabled && "online")} />
          </button>
        ))}
        <button className="add-provider" onClick={() => add("openai-images")}>
          <Plus size={15} />
          OpenAI 兼容
        </button>
        <button className="add-provider" onClick={() => add("google-images")}>
          <Plus size={15} />
          Gemini 原生
        </button>
      </div>
      {!p ? (
        <div className="settings-empty">
          <ImagePlus size={35} />
          <h3>为想象力连接一个模型</h3>
          <p>支持 OpenAI Images 兼容接口和 Gemini 原生生图。</p>
        </div>
      ) : (
        <div className="provider-editor" key={p.id}>
          <div className="row between">
            <h3>{p.name}</h3>
            <div className="row gap">
              <Toggle
                checked={p.enabled}
                onChange={(enabled) => patch({ enabled })}
                label="启用生图供应商"
              />
              <IconButton
                label="移除生图供应商"
                onClick={() => setDeleting(true)}
              >
                <Trash2 size={15} />
              </IconButton>
            </div>
          </div>
          {deleting && (
            <div className="inline-confirm">
              <span>移除供应商？画廊里的图片会保留。</span>
              <button
                className="button small"
                onClick={() => setDeleting(false)}
              >
                取消
              </button>
              <button
                className="button small danger"
                onClick={() => {
                  update({
                    imageProviders: settings.imageProviders.filter(
                      (item) => item.id !== p.id,
                    ),
                    ...(settings.defaultImageModel?.startsWith(p.id + "::")
                      ? { defaultImageModel: undefined }
                      : {}),
                  });
                  setDeleting(false);
                }}
              >
                移除
              </button>
            </div>
          )}
          <div className="form-grid">
            <Field label="生图供应商名称">
              <input
                aria-label="生图供应商名称"
                value={p.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </Field>
            <Field label="生图接口协议">
              <select
                aria-label="生图接口协议"
                value={p.protocol}
                onChange={(e) =>
                  patch({
                    protocol: e.target.value as ImageProvider["protocol"],
                  })
                }
              >
                <option value="openai-images">OpenAI Images 兼容</option>
                <option value="google-images">Google Gemini 原生</option>
              </select>
            </Field>
          </div>
          <Field
            label="生图 API 地址"
            hint={
              p.protocol === "openai-images"
                ? "填写 API 根地址，例如 https://你的网关/v1。"
                : "原生 Gemini 根地址通常以 /v1beta 结尾。"
            }
          >
            <input
              aria-label="生图 API 地址"
              value={p.baseURL}
              onChange={(e) => patch({ baseURL: e.target.value.trim() })}
            />
          </Field>
          {settings.providers.length > 0 && (
            <Field label="复用已有连接">
              <select
                aria-label="复制聊天供应商连接"
                value=""
                onChange={(e) => {
                  const source = settings.providers.find(
                    (item) => item.id === e.target.value,
                  );
                  if (source) {
                    patch({
                      name: source.name + " · 生图",
                      baseURL: source.baseURL,
                      keys: [...source.keys],
                      headers: { ...source.headers },
                      protocol:
                        source.protocol === "google"
                          ? "google-images"
                          : "openai-images",
                    });
                    notify("已复制连接，可单独修改生图配置");
                  }
                }}
              >
                <option value="">从聊天供应商复制地址与密钥…</option>
                {settings.providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <KeysEditor keys={p.keys} onChange={(keys) => patch({ keys })} />
          <div className="row between wrap gap">
            <h3>
              生图模型 <span className="count-badge">{p.models.length}</span>
            </h3>
            <button
              className="button small"
              disabled={busy || !p.baseURL}
              onClick={async () => {
                setBusy(true);
                try {
                  const ids = await bridge.models({
                    ...p,
                    protocol:
                      p.protocol === "google-images" ? "google" : "openai",
                    modelConfigs: {},
                  });
                  patch({ availableModels: ids });
                  notify(`已拉取 ${ids.length} 个模型，请勾选支持生图的模型`);
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <CloudDownload size={14} />
              )}
              拉取模型
            </button>
          </div>
          <div className="row gap image-model-add">
            <input
              aria-label="手动添加生图模型"
              placeholder={
                p.protocol === "google-images"
                  ? "输入 Gemini 生图模型 ID"
                  : "输入生图模型 ID，例如 gpt-image-1"
              }
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && manual.trim()) {
                  patch({ models: [...new Set([...p.models, manual.trim()])] });
                  setManual("");
                }
              }}
            />
            <button
              className="button"
              disabled={!manual.trim()}
              onClick={() => {
                patch({ models: [...new Set([...p.models, manual.trim()])] });
                setManual("");
              }}
            >
              <Plus size={14} />
              添加
            </button>
          </div>
          <div className="image-model-filter">
            <input
              ref={filterInput}
              aria-label="筛选生图模型"
              placeholder="筛选模型…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <IconButton
                label="清除生图模型筛选"
                onClick={() => {
                  setQuery("");
                  filterInput.current?.focus();
                }}
              >
                <X size={14} />
              </IconButton>
            )}
          </div>
          <div className="image-model-grid">
            {filtered.length === 0 && (
              <p className="image-model-empty" role="status">
                {all.length === 0 ? "请先拉取或添加模型" : "没有匹配的模型"}
              </p>
            )}
            {filtered.slice(0, 120).map((model) => (
              <button
                key={model}
                className={cx(
                  "image-model-option",
                  p.models.includes(model) && "selected",
                )}
                role="checkbox"
                aria-checked={p.models.includes(model)}
                onClick={() => toggle(model)}
              >
                <span className="model-check">
                  {p.models.includes(model) && <Check size={12} />}
                </span>
                <span>{model}</span>
              </button>
            ))}
          </div>
          {filtered.length > 120 && (
            <p className="muted text-xs">显示前 120 项，请输入关键词筛选。</p>
          )}
          <Field label="默认生图模型">
            <select
              aria-label="默认生图模型"
              value={settings.defaultImageModel || ""}
              onChange={(e) =>
                update({ defaultImageModel: e.target.value || undefined })
              }
            >
              <option value="">自动使用首个已启用模型</option>
              {settings.imageProviders
                .filter((item) => item.enabled)
                .flatMap((item) =>
                  item.models.map((model) => (
                    <option
                      key={item.id + model}
                      value={item.id + "::" + model}
                    >
                      {item.name} / {model}
                    </option>
                  )),
                )}
            </select>
          </Field>
          <details className="image-advanced">
            <summary>高级 · 自定义请求头</summary>
            <Field label="JSON 请求头">
              <textarea
                key={JSON.stringify(p.headers || {})}
                aria-label="生图自定义请求头"
                rows={3}
                defaultValue={JSON.stringify(p.headers || {}, null, 2)}
                onBlur={(e) => {
                  try {
                    const value = JSON.parse(e.target.value);
                    if (
                      !value ||
                      typeof value !== "object" ||
                      Array.isArray(value) ||
                      Object.values(value).some((v) => typeof v !== "string")
                    )
                      throw new Error("需要字符串键值对象");
                    patch({ headers: value });
                  } catch {
                    notify("自定义请求头需要有效的 JSON 字符串键值对象");
                  }
                }}
              />
            </Field>
          </details>
        </div>
      )}
    </div>
  );
}
