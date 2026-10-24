import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CheckCheck,
  ChevronDown,
  CloudDownload,
  Code2,
  ExternalLink,
  Github,
  Globe2,
  Info,
  Loader2,
  Palette,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareDashedMousePointer,
  Trash2,
  Waypoints,
  Wrench,
  X,
  ImagePlus,
  ChartNoAxesCombined,
} from "lucide-react";
import { bridge } from "./bridge";
import { appInfo } from "./app-info";
import Appearance from "./Appearance";
import ReasoningLevelsInput from "./ReasoningLevelsInput";
import { newProvider } from "./defaults";
import { matchModel } from "./model-catalog";
import { exportBackup, importBackup, parseCustomTool } from "./state-data";
import type {
  AppState,
  ModelConfig,
  Provider,
  Settings as SettingsType,
  ToolInfo,
} from "./types";
import {
  CapabilityTags,
  CloseButton,
  Field,
  IconButton,
  KeysEditor,
  Logo,
  Modal,
  Toggle,
  cx,
} from "./ui";
export type SettingsTab =
  | "providers"
  | "images"
  | "usage"
  | "search"
  | "appearance"
  | "tools"
  | "data"
  | "about";
const ImageSettings = lazy(() => import("./ImageSettings"));
const UsageSettings = lazy(() => import("./UsageSettings"));
type ProviderPatch =
  Partial<Provider> | ((current: Provider) => Partial<Provider>);
type Props = {
  state: AppState;
  onChange: (state: AppState | ((current: AppState) => AppState)) => void;
  onClose: () => void;
  notify: (text: string) => void;
  tools: ToolInfo[];
  initialTab?: SettingsTab;
};
const tabs = [
  { id: "providers", label: "供应商与模型", icon: Waypoints },
  { id: "images", label: "生图供应商", icon: ImagePlus },
  { id: "search", label: "网页搜索", icon: Globe2 },
  { id: "tools", label: "工具扩展", icon: Wrench },
  { id: "appearance", label: "外观与皮肤", icon: Palette },
  { id: "data", label: "数据与偏好", icon: Settings2 },
  { id: "usage", label: "Token 统计", icon: ChartNoAxesCombined },
  { id: "about", label: "关于", icon: Info },
] as const;
export default function Settings({
  state,
  onChange,
  onClose,
  notify,
  tools,
  initialTab = "providers",
}: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [selected, setSelected] = useState(
    state.settings.providers[0]?.id || "",
  );
  const [busy, setBusy] = useState("");
  const settings = state.settings;
  const update = (
    patch:
      | Partial<SettingsType>
      | ((current: SettingsType) => Partial<SettingsType>),
  ) =>
    onChange((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ...(typeof patch === "function" ? patch(current.settings) : patch),
      },
    }));
  const provider =
    settings.providers.find((p) => p.id === selected) || settings.providers[0];
  const patchProvider = (patch: ProviderPatch) => {
    if (provider)
      onChange((current) => ({
        ...current,
        settings: {
          ...current.settings,
          providers: current.settings.providers.map((p) =>
            p.id === provider.id
              ? { ...p, ...(typeof patch === "function" ? patch(p) : patch) }
              : p,
          ),
        },
      }));
  };
  const run = async (id: string, operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(id);
    try {
      await operation();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const [deleteId, setDeleteId] = useState("");
  return (
    <Modal title="Lumen 设置" wide onClose={onClose}>
      <div className="settings-shell">
        <nav className="settings-nav">
          <div className="settings-brand">
            <Logo small />
            <span>偏好设置</span>
          </div>
          <div className="settings-tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                aria-label={t.label}
                aria-current={tab === t.id ? "page" : undefined}
                title={t.label}
                className={cx(
                  tab === t.id && "active",
                  t.id === "about" && "settings-about-tab",
                )}
                onClick={() => setTab(t.id)}
              >
                <t.icon size={17} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <section className="settings-main">
          <header className="settings-header">
            <div>
              <h2>{tabs.find((t) => t.id === tab)?.label}</h2>
            </div>
            <CloseButton onClose={onClose} />
          </header>
          <div className="settings-content">
            {tab === "images" && (
              <Suspense
                fallback={
                  <div className="settings-empty">
                    <Loader2 size={22} className="spin" />
                  </div>
                }
              >
                <ImageSettings
                  settings={settings}
                  update={update}
                  notify={notify}
                />
              </Suspense>
            )}
            {tab === "usage" && (
              <Suspense
                fallback={
                  <div className="settings-empty">
                    <Loader2 size={22} className="spin" />
                  </div>
                }
              >
                <UsageSettings notify={notify} />
              </Suspense>
            )}
            {tab === "providers" && (
              <>
                <p className="section-description">
                  连接你信任的供应商，把常用模型放进启动列表。
                </p>
                <div className="provider-layout">
                  <aside className="provider-list">
                    {settings.providers.map((p) => (
                      <button
                        key={p.id}
                        className={cx(
                          "provider-card",
                          p.id === provider?.id && "active",
                        )}
                        onClick={() => setSelected(p.id)}
                      >
                        <span className="provider-avatar">
                          {p.name[0] || "P"}
                        </span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>{p.models.length} 个启动模型</small>
                        </span>
                        <i
                          className={cx("status-dot", p.enabled && "online")}
                        />
                      </button>
                    ))}
                    <button
                      className="add-provider"
                      onClick={() => {
                        const p = newProvider();
                        update({ providers: [...settings.providers, p] });
                        setSelected(p.id);
                      }}
                    >
                      <Plus size={16} />
                      添加供应商
                    </button>
                  </aside>
                  {provider ? (
                    <div className="provider-editor" key={provider.id}>
                      <div className="row between">
                        <h3>{provider.name}</h3>
                        <div className="row gap">
                          <span className="muted text-xs">启用</span>
                          <Toggle
                            label="启用供应商"
                            checked={provider.enabled}
                            onChange={(enabled) => patchProvider({ enabled })}
                          />
                          <IconButton
                            label="移除供应商"
                            onClick={() => setDeleteId(provider.id)}
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      </div>
                      <div className="form-grid">
                        <Field label="名称">
                          <input
                            value={provider.name}
                            onChange={(e) =>
                              patchProvider({ name: e.target.value })
                            }
                            placeholder="例如：我的模型网关"
                          />
                        </Field>
                        <Field label="接口协议">
                          <select
                            aria-label="接口协议"
                            value={provider.protocol}
                            onChange={(e) =>
                              patchProvider({
                                protocol: e.target
                                  .value as Provider["protocol"],
                              })
                            }
                          >
                            <option value="openai">OpenAI 兼容 · Chat</option>
                            <option value="responses">
                              OpenAI · Responses
                            </option>
                            <option value="anthropic">
                              Anthropic · Messages
                            </option>
                            <option value="google">Google · Gemini</option>
                          </select>
                        </Field>
                      </div>
                      <Field
                        label="API 地址"
                        hint="填写 API 根地址，例如 https://你的网关/v1；Gemini 原生通常以 /v1beta 结尾。"
                      >
                        <input
                          aria-label="API 地址"
                          placeholder="https://api.example.com/v1"
                          value={provider.baseURL}
                          onChange={(e) =>
                            patchProvider({ baseURL: e.target.value.trim() })
                          }
                        />
                      </Field>
                      <KeysEditor
                        keys={provider.keys}
                        onChange={(keys) => patchProvider({ keys })}
                      />
                      <div className="provider-default">
                        <Field
                          label="默认推理强度"
                          hint="会话的「自动」继承此设置；这里选 auto 时不发送参数。"
                        >
                          <input
                            list="efforts"
                            value={provider.defaultEffort || "auto"}
                            onChange={(e) =>
                              patchProvider({ defaultEffort: e.target.value })
                            }
                            placeholder="auto / high / 自定义值"
                          />
                        </Field>
                      </div>
                      <ModelManager
                        provider={provider}
                        onChange={patchProvider}
                        notify={notify}
                        run={run}
                        busy={busy}
                      />
                    </div>
                  ) : (
                    <div className="settings-empty">
                      <Waypoints size={36} />
                      <h3>接入第一个供应商</h3>
                      <p>支持你的 API、中转网关和本地模型。</p>
                      <button
                        className="button primary"
                        onClick={() => {
                          const p = newProvider();
                          update({ providers: [p] });
                          setSelected(p.id);
                        }}
                      >
                        <Plus size={15} />
                        添加供应商
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
            {tab === "search" && (
              <SearchSettings
                settings={settings}
                update={update}
                run={run}
                busy={busy}
                notify={notify}
              />
            )}
            {tab === "appearance" && (
              <Appearance settings={settings} update={update} notify={notify} />
            )}
            {tab === "tools" && (
              <ToolSettings
                settings={settings}
                tools={tools}
                update={update}
                notify={notify}
              />
            )}
            {tab === "data" && (
              <DataSettings
                state={state}
                onChange={onChange}
                update={update}
                run={run}
                busy={busy}
                notify={notify}
              />
            )}
            {tab === "about" && <AboutSettings />}
          </div>
        </section>
      </div>
      <datalist id="efforts">
        {[
          "auto",
          "none",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ].map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      {deleteId && (
        <div className="confirm-cover">
          <div className="confirm-box">
            <Trash2 size={24} />
            <h3>移除这个供应商？</h3>
            <p>历史聊天会保留，供应商和密钥将从 Lumen 设置移除。</p>
            <div className="row gap">
              <button className="button" onClick={() => setDeleteId("")}>
                取消
              </button>
              <button
                className="button danger"
                onClick={() => {
                  update({
                    providers: settings.providers.filter(
                      (p) => p.id !== deleteId,
                    ),
                  });
                  setDeleteId("");
                }}
              >
                移除供应商
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
function ModelManager({
  provider: p,
  onChange,
  notify,
  run,
  busy,
}: {
  provider: Provider;
  onChange: (p: ProviderPatch) => void;
  notify: (text: string) => void;
  run: (id: string, fn: () => Promise<void>) => Promise<void>;
  busy: string;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState("");
  const [visible, setVisible] = useState(120);
  const [marquee, setMarquee] = useState(false);
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    initial: string[];
    moved: boolean;
  } | null>(null);
  const all = useMemo(
    () =>
      [...new Set([...p.models, ...p.availableModels])].sort((a, b) =>
        a.localeCompare(b),
      ),
    [p.models, p.availableModels],
  );
  const filtered = all.filter((id) =>
    id.toLowerCase().includes(query.toLowerCase()),
  );
  const toggle = (id: string) =>
    onChange({
      models: p.models.includes(id)
        ? p.models.filter((m) => m !== id)
        : [...p.models, id],
    });
  const match = async (ids: string[]) => {
    const catalog = await bridge.catalog();
    let count = 0;
    const next: Record<string, ModelConfig> = {};
    for (const id of ids) {
      const result = matchModel(id, catalog);
      if (result) {
        count++;
        next[id] = result;
      }
    }
    return { configs: next, count };
  };
  const mergeMatches = (
    latest: Provider,
    matches: Record<string, ModelConfig>,
  ) => ({
    ...latest.modelConfigs,
    ...Object.fromEntries(
      Object.entries(matches).filter(
        ([id]) => latest.modelConfigs[id]?.source !== "自定义",
      ),
    ),
  });
  const currentChange = useRef(onChange);
  currentChange.current = onChange;
  const startupIds = p.models.join("\0");
  useEffect(() => {
    let live = true;
    const ids = p.models.filter((id) => !p.modelConfigs[id]?.source);
    if (ids.length)
      void bridge
        .catalog()
        .then((catalog) => {
          if (!live) return;
          const matches = Object.fromEntries(
            ids
              .map((id) => [id, matchModel(id, catalog)])
              .filter(([, config]) => config),
          ) as Record<string, ModelConfig>;
          if (Object.keys(matches).length)
            currentChange.current((latest) => ({
              modelConfigs: {
                ...latest.modelConfigs,
                ...Object.fromEntries(
                  Object.entries(matches).filter(
                    ([id]) => !latest.modelConfigs[id]?.source,
                  ),
                ),
              },
            }));
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [p.id, startupIds]);
  const patchConfig = (id: string, patch: Partial<ModelConfig>) =>
    onChange({
      modelConfigs: {
        ...p.modelConfigs,
        [id]: { ...p.modelConfigs[id], ...patch, source: "自定义" },
      },
    });
  const config = editing ? p.modelConfigs[editing] || {} : null;
  return (
    <div className="model-manager">
      <div className="row between wrap">
        <div>
          <h3>
            启动模型 <span className="count-badge">{p.models.length}</span>
          </h3>
          <p className="sub-description">勾选后，即可在聊天中切换。</p>
        </div>
        <div className="row gap">
          <button
            className="button small"
            disabled={!!busy || !p.baseURL}
            onClick={() =>
              void run("models", async () => {
                const ids = await bridge.models(p);
                onChange({ availableModels: ids });
                notify(`已拉取 ${ids.length} 个模型`);
                try {
                  const result = await match([
                    ...new Set([...p.models, ...ids]),
                  ]);
                  onChange((latest) => ({
                    availableModels: ids,
                    modelConfigs: mergeMatches(latest, result.configs),
                  }));
                } catch {
                  notify("模型已拉取；能力目录暂不可用，可手动设置");
                }
              })
            }
          >
            {busy === "models" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <CloudDownload size={14} />
            )}
            拉取模型
          </button>
          <button
            className="button small"
            disabled={!!busy || !all.length}
            onClick={() =>
              void run("match", async () => {
                const result = await match(all);
                onChange((latest) => ({
                  modelConfigs: mergeMatches(latest, result.configs),
                }));
                notify(
                  `匹配到 ${result.count} / ${all.length} 个模型，手动配置已保留`,
                );
              })
            }
          >
            {busy === "match" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Sparkles size={14} />
            )}
            智能匹配
          </button>
        </div>
      </div>
      {p.models.length > 0 && (
        <div className="selected-models">
          {p.models.map((id) => (
            <span key={id} className="model-chip">
              <button onClick={() => setEditing(editing === id ? "" : id)}>
                {id}
              </button>
              <IconButton label={`移除 ${id}`} onClick={() => toggle(id)}>
                <X size={11} />
              </IconButton>
            </span>
          ))}
        </div>
      )}
      {all.length > 0 && (
        <>
          <div className="model-list-toolbar">
            <input
              aria-label="筛选模型"
              placeholder={`筛选 ${all.length} 个模型…`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisible(120);
              }}
            />
            <button
              className="text-button"
              onClick={() =>
                onChange({ models: [...new Set([...p.models, ...filtered])] })
              }
            >
              <CheckCheck size={14} />
              全选筛选结果
            </button>
            <IconButton
              label="拖动框选模型"
              className={cx(marquee && "selected")}
              onClick={() => setMarquee(!marquee)}
            >
              <SquareDashedMousePointer size={16} />
            </IconButton>
          </div>
          <div
            className={cx("model-grid", marquee && "marquee-mode")}
            ref={grid}
            onPointerDown={(e) => {
              if (!marquee || !grid.current) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              const bounds = grid.current.getBoundingClientRect();
              drag.current = {
                x: e.clientX - bounds.left + grid.current.scrollLeft,
                y: e.clientY - bounds.top + grid.current.scrollTop,
                initial: e.shiftKey ? p.models : [],
                moved: false,
              };
            }}
            onPointerMove={(e) => {
              if (!drag.current || !grid.current) return;
              const bounds = grid.current.getBoundingClientRect();
              const start = drag.current;
              const x = e.clientX - bounds.left + grid.current.scrollLeft,
                y = e.clientY - bounds.top + grid.current.scrollTop;
              const r = {
                left: Math.min(start.x, x),
                top: Math.min(start.y, y),
                width: Math.abs(x - start.x),
                height: Math.abs(y - start.y),
              };
              start.moved = start.moved || r.width + r.height > 5;
              if (!start.moved) return;
              setRect(r);
              const ids = [
                ...grid.current.querySelectorAll<HTMLElement>("[data-model]"),
              ]
                .filter((el) => {
                  const b = el.getBoundingClientRect();
                  return (
                    b.right >=
                      bounds.left + r.left - grid.current!.scrollLeft &&
                    b.left <=
                      bounds.left +
                        r.left +
                        r.width -
                        grid.current!.scrollLeft &&
                    b.bottom >= bounds.top + r.top - grid.current!.scrollTop &&
                    b.top <=
                      bounds.top + r.top + r.height - grid.current!.scrollTop
                  );
                })
                .map((el) => el.dataset.model!);
              onChange({ models: [...new Set([...start.initial, ...ids])] });
            }}
            onPointerUp={() => {
              drag.current = null;
              setRect(null);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setRect(null);
            }}
          >
            {filtered.slice(0, visible).map((id) => (
              <div
                key={id}
                data-model={id}
                className={cx("model-row", p.models.includes(id) && "checked")}
              >
                <button
                  role="checkbox"
                  aria-checked={p.models.includes(id)}
                  aria-label={`启动 ${id}`}
                  onClick={() => {
                    if (!marquee) toggle(id);
                  }}
                >
                  <span className="checkbox">
                    {p.models.includes(id) && <Check size={11} />}
                  </span>
                  <span className="model-row-label">
                    {id}
                    <CapabilityTags config={p.modelConfigs[id] || {}} />
                  </span>
                </button>
                <IconButton
                  label={`配置 ${id}`}
                  onClick={() => setEditing(editing === id ? "" : id)}
                >
                  <Settings2 size={13} />
                </IconButton>
              </div>
            ))}
            {!filtered.length && (
              <p className="empty-inline">没有匹配的模型。</p>
            )}
            {rect && <div className="selection-marquee" style={rect} />}
          </div>
          {filtered.length > visible && (
            <button
              className="text-button"
              onClick={() => setVisible((v) => v + 120)}
            >
              显示更多（还有 {filtered.length - visible} 个）
              <ChevronDown size={13} />
            </button>
          )}
          {marquee && (
            <small className="muted">
              拖动框选；按住 Shift 追加选择。再次点击框选按钮退出。
            </small>
          )}
        </>
      )}
      {editing && config && (
        <div className="model-config">
          <div className="row between">
            <h4>{editing}</h4>
            <IconButton label="收起模型配置" onClick={() => setEditing("")}>
              <X size={14} />
            </IconButton>
          </div>
          <p className="sub-description">
            {config.matchedId
              ? `已匹配 ${config.matchedId} · ${config.source}`
              : "未匹配到目录，可按上游文档手动配置。"}
          </p>
          <div className="config-toggles">
            {(
              [
                { key: "vision", label: "视觉输入" },
                { key: "reasoning", label: "推理思考" },
                { key: "tools", label: "工具调用" },
              ] as const
            ).map((t) => (
              <div key={t.key}>
                <span>{t.label}</span>
                <select
                  aria-label={t.label}
                  value={
                    config[t.key] === undefined ? "auto" : String(config[t.key])
                  }
                  onChange={(e) =>
                    patchConfig(editing, {
                      [t.key]:
                        e.target.value === "auto"
                          ? undefined
                          : e.target.value === "true",
                    })
                  }
                >
                  <option value="auto">未指定</option>
                  <option value="true">支持</option>
                  <option value="false">不支持</option>
                </select>
              </div>
            ))}
          </div>
          <div className="form-grid">
            <Field
              label="支持的推理档位"
              hint="逗号、分号或回车分隔，支持中文标点。"
            >
              <ReasoningLevelsInput
                key={`${p.id}:${editing}`}
                value={config.levels}
                onChange={(levels) => patchConfig(editing, { levels })}
              />
            </Field>
            <Field label="推理参数形式">
              <select
                value={config.reasoningMode || "effort"}
                onChange={(e) =>
                  patchConfig(editing, {
                    reasoningMode: e.target
                      .value as ModelConfig["reasoningMode"],
                  })
                }
              >
                <option value="effort">effort · 强度档位</option>
                <option value="toggle">toggle · 开启/关闭</option>
                <option value="budget">budget · 思考预算</option>
              </select>
            </Field>
            <Field label="上下文窗口">
              <input
                type="number"
                min="1"
                placeholder="例如 128000"
                value={config.context || ""}
                onChange={(e) =>
                  patchConfig(editing, {
                    context: Number(e.target.value) || undefined,
                  })
                }
              />
            </Field>
            <Field label="最大输出 Token">
              <input
                type="number"
                min="128"
                max="1000000"
                placeholder="默认 8192"
                value={config.maxTokens || ""}
                onChange={(e) =>
                  patchConfig(editing, {
                    maxTokens: Number(e.target.value) || undefined,
                  })
                }
              />
            </Field>
            <Field label="温度（可留空）">
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={config.temperature ?? ""}
                placeholder="跟随上游默认"
                onChange={(e) =>
                  patchConfig(editing, {
                    temperature:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
            </Field>
          </div>
          <button
            className="text-button"
            onClick={() =>
              void run("match", async () => {
                const raw = await bridge.catalog();
                const result = matchModel(editing, raw);
                if (result)
                  onChange({
                    modelConfigs: { ...p.modelConfigs, [editing]: result },
                  });
                else notify("目录中没有匹配项，请保留手动配置");
              })
            }
          >
            <Sparkles size={13} />
            恢复目录匹配
          </button>
        </div>
      )}
    </div>
  );
}
function SearchSettings({
  settings,
  update,
  run,
  busy,
  notify,
}: {
  settings: SettingsType;
  update: (p: Partial<SettingsType>) => void;
  run: (id: string, fn: () => Promise<void>) => Promise<void>;
  busy: string;
  notify: (t: string) => void;
}) {
  const config = settings.search;
  const patch = (p: Partial<typeof config>) =>
    update({
      search: { ...config, ...p },
      ...(p.enabled
        ? {
            disabledTools: settings.disabledTools.filter(
              (name) => name !== "web_search",
            ),
          }
        : {}),
    });
  const [query, setQuery] = useState("uTools 插件开发文档");
  const [result, setResult] = useState("");
  return (
    <div className="settings-section">
      <p className="section-description">
        让 Agent 获取实时信息，并在回答中附上来源。
      </p>
      <div className="feature-banner">
        <span className="feature-icon">
          <Globe2 size={23} />
        </span>
        <div>
          <strong>网页搜索</strong>
          <p>接入 AnySearch 或你自己的搜索服务。</p>
        </div>
        <Toggle
          checked={config.enabled}
          label="启用网页搜索"
          onChange={(enabled) => patch({ enabled })}
        />
      </div>
      <div className="form-grid">
        <Field label="搜索服务">
          <select
            value={config.engine}
            onChange={(e) => {
              const engine = e.target.value as typeof config.engine;
              patch({
                engine,
                endpoint:
                  engine === "anysearch"
                    ? "https://api.anysearch.com/mcp"
                    : engine === "tavily"
                      ? "https://api.tavily.com/search"
                      : engine === "searxng"
                        ? "http://localhost:8080/search"
                        : "",
                keyMode: engine === "tavily" ? "body" : "bearer",
              });
            }}
          >
            <option value="anysearch">AnySearch · 官方 MCP</option>
            <option value="tavily">Tavily</option>
            <option value="searxng">SearXNG</option>
            <option value="custom">自定义 JSON 搜索</option>
          </select>
        </Field>
        <Field label="每次结果数量">
          <select
            value={config.limit}
            onChange={(e) => patch({ limit: Number(e.target.value) })}
          >
            {[3, 5, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n} 条结果
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="搜索接口地址">
        <input
          aria-label="搜索接口地址"
          value={config.endpoint}
          onChange={(e) => patch({ endpoint: e.target.value })}
        />
      </Field>
      {config.engine !== "anysearch" && (
        <Field label="密钥传递方式">
          <select
            value={config.keyMode}
            onChange={(e) =>
              patch({ keyMode: e.target.value as typeof config.keyMode })
            }
          >
            <option value="bearer">Authorization: Bearer</option>
            <option value="x-api-key">X-API-Key 请求头</option>
            <option value="body">请求体 api_key</option>
          </select>
        </Field>
      )}
      <KeysEditor keys={config.keys} onChange={(keys) => patch({ keys })} />
      <div className="info-note">
        <ShieldCheck size={16} />
        <p>
          多个密钥按顺序轮询。遇到鉴权、限流或服务错误时，会尝试下一个密钥。
          {config.engine === "anysearch"
            ? "不填密钥时使用 AnySearch 匿名访问。"
            : ""}
        </p>
      </div>
      <div className="section-divider" />
      <h3>测试搜索</h3>
      <div className="row gap">
        <input
          aria-label="测试搜索词"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="button primary"
          disabled={!!busy || !query.trim()}
          onClick={() =>
            void run("search", async () => {
              setResult("");
              const data = await bridge.searchTest(config, query);
              setResult(
                typeof data === "string" ? data : JSON.stringify(data, null, 2),
              );
              notify("搜索连接成功");
            })
          }
        >
          {busy === "search" ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Globe2 size={15} />
          )}
          测试
        </button>
      </div>
      {result && <pre className="test-result">{result}</pre>}
      <button
        className="text-button"
        onClick={() =>
          bridge.openExternal("https://anysearch.com/console/api-keys")
        }
      >
        获取 AnySearch 密钥
        <ExternalLink size={13} />
      </button>
    </div>
  );
}
export function Preference({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="preference-row">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </div>
  );
}
function ToolSettings({
  settings,
  tools,
  update,
  notify,
}: {
  settings: SettingsType;
  tools: ToolInfo[];
  update: (p: Partial<SettingsType>) => void;
  notify: (t: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [raw, setRaw] = useState(
    JSON.stringify(
      {
        name: "my_tool",
        title: "我的工具",
        description: "说明工具做什么",
        group: "扩展工具",
        endpoint: "https://your-service.example/tool",
        method: "POST",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
      },
      null,
      2,
    ),
  );
  const groups = [...new Set(tools.map((t) => t.group))];
  return (
    <div className="settings-section">
      <p className="section-description">
        按需开启能力。Agent 可以通过 list_tools 发现已注册工具。
      </p>
      {groups.map((group) => (
        <div className="tool-settings-group" key={group}>
          <h3>{group}</h3>
          {tools
            .filter((t) => t.group === group)
            .map((t) => (
              <div className="tool-setting-row" key={t.name}>
                <span className="tool-small-icon">
                  <Wrench size={15} />
                </span>
                <div>
                  <strong>
                    {t.title}
                    <code>{t.name}</code>
                  </strong>
                  <p>{t.description}</p>
                  {t.approval && (
                    <small className="approval-hint">
                      {settings.toolPermission === "always_allow"
                        ? "Auto · 自动允许"
                        : "执行前由你确认"}
                    </small>
                  )}
                </div>
                {t.custom && (
                  <IconButton
                    label={`移除工具 ${t.name}`}
                    onClick={() =>
                      update({
                        customTools: settings.customTools.filter(
                          (x) => x.name !== t.name,
                        ),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </IconButton>
                )}
                <Toggle
                  label={`启用 ${t.title}`}
                  disabled={t.name === "list_tools"}
                  checked={t.enabled}
                  onChange={(v) =>
                    update({
                      ...(t.name === "web_search"
                        ? { search: { ...settings.search, enabled: v } }
                        : {}),
                      disabledTools: v
                        ? settings.disabledTools.filter((x) => x !== t.name)
                        : [...settings.disabledTools, t.name],
                    })
                  }
                />
              </div>
            ))}
        </div>
      ))}
      <button className="button" onClick={() => setAdding(!adding)}>
        <Plus size={15} />
        注册 HTTP 工具
      </button>
      {adding && (
        <div className="custom-tool-editor">
          <p className="sub-description">
            填写工具定义与 JSON Schema，执行时遵循输入框的权限模式。
          </p>
          <textarea
            aria-label="工具 JSON 定义"
            className="code-input"
            rows={15}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          <button
            className="button primary"
            onClick={() => {
              try {
                const t = parseCustomTool(JSON.parse(raw));
                if (tools.some((x) => x.name === t.name))
                  throw new Error("工具名已存在");
                update({ customTools: [...settings.customTools, t] });
                notify("工具已注册");
                setAdding(false);
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <Check size={14} />
            注册工具
          </button>
        </div>
      )}
      <div className="info-note">
        <Code2 size={17} />
        <p>
          开发者也可以通过 preload 的 registerTool
          注册本地工具。接口文档和示例位于工程 docs 目录。
        </p>
      </div>
    </div>
  );
}
function DataSettings({
  state,
  onChange,
  update,
  run,
  busy,
  notify,
}: {
  state: AppState;
  onChange: (s: AppState | ((current: AppState) => AppState)) => void;
  update: (p: Partial<SettingsType>) => void;
  run: (id: string, fn: () => Promise<void>) => Promise<void>;
  busy: string;
  notify: (t: string) => void;
}) {
  const settings = state.settings;
  const importRef = useRef<HTMLInputElement>(null);
  const [includeKeys, setIncludeKeys] = useState(false);
  return (
    <div className="settings-section">
      <h3>快捷指令</h3>
      <Field label="默认 Agent" hint="用于新对话、AI 翻译、截图翻译和问答。">
        <select
          aria-label="默认 Agent"
          value={
            settings.defaultModel ||
            settings.providers
              .filter((p) => p.enabled)
              .flatMap((p) => p.models.map((m) => p.id + "::" + m))[0] ||
            ""
          }
          onChange={(e) => update({ defaultModel: e.target.value })}
        >
          {!settings.providers.some((p) => p.enabled && p.models.length) && (
            <option value="">请先添加启动模型</option>
          )}
          {settings.providers
            .filter((p) => p.enabled)
            .map((p) => (
              <optgroup key={p.id} label={p.name}>
                {p.models.map((m) => (
                  <option key={m} value={p.id + "::" + m}>
                    {m}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
      </Field>
      <Field label="翻译目标语言">
        <input
          aria-label="翻译目标语言"
          list="translation-languages"
          value={settings.translationLanguage}
          onChange={(e) => update({ translationLanguage: e.target.value })}
          placeholder="cn"
        />
        <datalist id="translation-languages">
          <option value="cn">简体中文</option>
          <option value="en">英语</option>
          <option value="ja">日语</option>
          <option value="ko">韩语</option>
          <option value="zh-tw">繁體中文</option>
          <option value="fr">法语</option>
          <option value="de">德语</option>
          <option value="es">西班牙语</option>
        </datalist>
      </Field>
      <div className="section-divider" />
      <h3>备份与恢复</h3>
      <p className="sub-description">
        导出配置与会话，随时带走。默认不包含密钥。
      </p>
      <Preference
        label="导出时包含密钥"
        description="开启后导出文件含明文密钥，请保存在私密位置。"
        checked={includeKeys}
        onChange={setIncludeKeys}
      />
      <div className="row gap">
        <button
          className="button"
          disabled={!!busy}
          onClick={() =>
            void run("export", async () => {
              const safe = exportBackup(state, includeKeys);
              await bridge.exportFile(
                "lumen-backup.json",
                JSON.stringify(safe, null, 2),
              );
            })
          }
        >
          <ArrowDownToLine size={15} />
          导出备份
        </button>
        <button className="button" onClick={() => importRef.current?.click()}>
          <ArrowUpFromLine size={15} />
          导入配置
        </button>
      </div>
      <input
        hidden
        ref={importRef}
        type="file"
        accept=".json"
        onChange={async (e) => {
          try {
            const f = e.target.files?.[0];
            if (!f) return;
            const data = JSON.parse(await f.text());
            // Validate fully before mutating any existing configuration.
            const result = importBackup(data, state);
            onChange((current) => importBackup(data, current).state);
            notify(`已导入 ${result.count} 个供应商`);
          } catch (error) {
            notify((error as Error).message);
          }
          e.target.value = "";
        }}
      />
      <div className="section-divider" />
      <h3>聊天偏好</h3>
      <Field label="发送快捷键">
        <select
          value={settings.sendKey}
          onChange={(e) =>
            update({ sendKey: e.target.value as SettingsType["sendKey"] })
          }
        >
          <option value="enter">Enter 发送 · Shift + Enter 换行</option>
          <option value="ctrl-enter">Ctrl + Enter 发送 · Enter 换行</option>
        </select>
      </Field>
      <Field label="系统提示词" hint="会应用于每次模型请求。">
        <textarea
          rows={5}
          value={settings.systemPrompt}
          onChange={(e) => update({ systemPrompt: e.target.value })}
        />
      </Field>
    </div>
  );
}

function AboutSettings() {
  return (
    <div className="settings-section about-settings">
      <div className="about-card">
        <Logo small />
        <strong>{appInfo.name}</strong>
        <span className="version-tag" aria-label={`版本 ${appInfo.version}`}>
          v{appInfo.version}
        </span>
      </div>
      <a
        className="about-repository"
        href={appInfo.repositoryUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="打开 GitHub 开源仓库"
        onClick={(event) => {
          event.preventDefault();
          bridge.openExternal(appInfo.repositoryUrl);
        }}
      >
        <Github size={18} />
        <span>{appInfo.repositoryUrl.replace(/^https?:\/\//, "")}</span>
        <ExternalLink size={15} />
      </a>
    </div>
  );
}
