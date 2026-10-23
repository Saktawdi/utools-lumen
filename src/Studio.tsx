import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clock3,
  Download,
  Images,
  ImagePlus,
  Loader2,
  Maximize2,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { bridge } from "./bridge";
import { imageProfile, sizeLabel } from "./image-models";
import type { Attachment, ImageAsset, ImageJob, Settings } from "./types";
import {
  AssetImage,
  forgetImageAsset,
  ImageViewer,
  loadImageAsset,
} from "./ImageAssets";
import { Field, IconButton, Modal, cx } from "./ui";

const examples = [
  {
    name: "一束光的形状",
    tag: "静物 · 光影",
    prompt:
      "一张有留白的静物摄影：一只半透明的青绿色玻璃花瓶放在米白色石台上，几枝细长的植物，午后阳光从左侧投下柔和的长影，纸张般细腻的质感，安静、克制，编辑杂志封面构图，无文字。",
  },
  {
    name: "把日常缩小",
    tag: "微缩 · 想象",
    prompt:
      "一本摊开的书中生长出一座微缩的山间书店，暖黄色灯光、细小的木质阶梯、苔藓与松树，蓝调黄昏，等距视角，精致的手工模型质感，丰富但有序的细节。",
  },
  {
    name: "来自远方的明信片",
    tag: "插画 · 旅行",
    prompt:
      "一幅现代旅行海报插画：海边的小城、弯曲的石阶、深蓝色的海与奶油色的房屋，橙色夕阳，丝网印刷颗粒，清晰色块，简约构图，无文字。",
  },
];
const statusText = {
  running: "正在生成",
  done: "已完成",
  error: "生成失败",
  cancelled: "已停止",
};
export default function Studio({
  settings,
  hidden,
  sidebar,
  onSidebar,
  onChat,
  onSettings,
  notify,
}: {
  settings: Settings;
  hidden: boolean;
  sidebar: boolean;
  onSidebar: () => void;
  onChat: () => void;
  onSettings: () => void;
  notify: (text: string) => void;
}) {
  const [tab, setTab] = useState<"generate" | "gallery">("generate");
  const [modelKey, setModelKey] = useState(settings.defaultImageModel || "");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("auto");
  const [quality, setQuality] = useState("auto");
  const [background, setBackground] = useState("auto");
  const [count, setCount] = useState(1);
  const [references, setReferences] = useState<Attachment[]>([]);
  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [limit, setLimit] = useState(24);
  const [viewer, setViewer] = useState<{ job: ImageJob; index: number }>();
  const [deleting, setDeleting] = useState<ImageJob>();
  const [dragging, setDragging] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const models = useMemo(
    () =>
      settings.imageProviders
        .filter((p) => p.enabled)
        .flatMap((p) =>
          p.models.map((model) => ({
            key: p.id + "::" + model,
            model,
            provider: p,
          })),
        ),
    [settings.imageProviders],
  );
  const selected =
    models.find((m) => m.key === modelKey) ||
    models.find((m) => m.key === settings.defaultImageModel) ||
    models[0];
  const google = selected?.provider.protocol === "google-images";
  const profile = imageProfile(
    selected?.model || "",
    selected?.provider.protocol,
  );
  const referenceError =
    references.length > profile.maxReferences
      ? profile.maxReferences
        ? `当前模型最多支持 ${profile.maxReferences} 张参考图`
        : "当前模型不支持参考图，请移除参考图或切换模型"
      : "";
  const active = jobs.find((j) => j.id === jobId) || jobs[0];
  const refresh = useCallback(async () => {
    try {
      setJobs(await bridge.imageJobs());
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (!hidden) void refresh();
  }, [hidden, refresh]);
  const running = jobs.some((j) => j.status === "running");
  useEffect(() => {
    if (!busy && !running) return;
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [busy, running, refresh]);
  useEffect(() => {
    if (hidden) return;
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [hidden, refresh]);
  const chooseModel = (key: string) => {
    setModelKey(key);
    setSize("auto");
    setQuality("auto");
    setBackground("auto");
    setCount(1);
  };
  const addFiles = async (incoming: File[]) => {
    if (!profile.maxReferences) {
      notify("当前模型不支持参考图，请切换模型");
      return;
    }
    const next: Attachment[] = [];
    for (const f of incoming) {
      if (references.length + next.length >= profile.maxReferences) {
        notify(`当前模型最多添加 ${profile.maxReferences} 张参考图`);
        break;
      }
      if (
        !/^image\/(png|jpeg|webp)$/.test(f.type) ||
        f.size > 12 * 1024 * 1024
      ) {
        notify("参考图支持 PNG、JPEG、WebP，单张不超过 12 MB");
        continue;
      }
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("无法读取图片"));
        r.readAsDataURL(f);
      });
      next.push({
        id: crypto.randomUUID(),
        type: "image",
        name: f.name || "参考图.png",
        mime: f.type,
        size: f.size,
        data,
      });
    }
    setReferences((current) =>
      [...current, ...next].slice(0, profile.maxReferences),
    );
  };
  const addReference = async (asset: ImageAsset) => {
    if (!profile.maxReferences) {
      notify("当前模型不支持参考图，请切换模型");
      return;
    }
    if (references.length >= profile.maxReferences) {
      notify(
        `当前模型最多添加 ${profile.maxReferences} 张参考图，请先移除一张`,
      );
      return;
    }
    try {
      const data = await loadImageAsset(asset.id);
      setReferences((current) =>
        [
          ...current,
          {
            id: asset.id,
            type: "image",
            name: "生成的参考图",
            data,
            mime: asset.mime,
            size: asset.size,
          } as Attachment,
        ].slice(0, profile.maxReferences),
      );
      setTab("generate");
      notify("已添加参考图，描述你想修改的地方");
      textarea.current?.focus();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const generate = async () => {
    if (!selected) {
      onSettings();
      return;
    }
    if (!prompt.trim() || submitting.current) return;
    if (referenceError) {
      notify(referenceError);
      return;
    }
    submitting.current = true;
    setBusy(true);
    const id = crypto.randomUUID();
    setJobId(id);
    try {
      const job = await bridge.imageGenerate({
        id,
        provider: selected.provider,
        model: selected.model,
        prompt: prompt.trim(),
        size: profile.sizes.includes(size) ? size : "auto",
        quality: profile.qualities.includes(quality) ? quality : "auto",
        background: profile.background ? background : "auto",
        count: Math.min(count, profile.maxCount),
        references,
        source: "studio",
      });
      setJobId(job.id);
      await refresh();
      if (job.status === "done") notify(`已生成 ${job.images.length} 张图片`);
      else if (job.status === "error") notify("生成未完成，可查看原因后重试");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
      void refresh();
    }
  };
  const reuse = async (job: ImageJob) => {
    const key = job.providerId + "::" + job.model;
    if (models.some((m) => m.key === key)) setModelKey(key);
    else notify("原模型已移除，将使用当前模型");
    setPrompt(job.prompt);
    setSize(job.size);
    setQuality(job.quality);
    setCount(job.count);
    setBackground(job.background);
    try {
      const restored = await Promise.all(
        (job.references || []).map(async (a) => ({
          id: a.id,
          type: "image" as const,
          name: "原任务参考图",
          mime: a.mime,
          size: a.size,
          data: await loadImageAsset(a.id),
        })),
      );
      setReferences(restored);
    } catch {
      setReferences([]);
      notify("部分参考图不可用，请重新添加");
    }
    setTab("generate");
    setJobId(job.id);
    textarea.current?.focus();
  };
  const toggleFavorite = async (job: ImageJob) => {
    try {
      await bridge.imageFavorite(job.id, !job.favorite);
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const download = async (asset: ImageAsset) => {
    try {
      await bridge.saveImage(asset.id);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const filtered = useMemo(
    () =>
      jobs.filter(
        (j) =>
          (!favorites || j.favorite) &&
          (j.prompt + j.model + j.providerName)
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [jobs, favorites, search],
  );
  return (
    <main
      className="studio"
      hidden={hidden}
      onDragEnter={(e) => {
        e.stopPropagation();
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        setTab("generate");
        void addFiles([...e.dataTransfer.files]).catch((e) =>
          notify(e.message),
        );
      }}
      onPaste={(e) => {
        const files = [...e.clipboardData.items]
          .filter((i) => i.kind === "file")
          .map((i) => i.getAsFile())
          .filter(Boolean) as File[];
        if (files.length) {
          e.preventDefault();
          e.stopPropagation();
          void addFiles(files).catch((e) => notify(e.message));
        }
      }}
    >
      <header className="studio-topbar">
        <div className="row gap">
          {!sidebar && (
            <IconButton label="展开侧栏" onClick={onSidebar}>
              <PanelLeftOpen size={18} />
            </IconButton>
          )}
          <span className="studio-mark">
            <WandSparkles size={18} />
          </span>
          <strong>生图工作室</strong>
          <span className="studio-beta">BETA</span>
        </div>
        <div className="row gap">
          <IconButton label="生图供应商设置" onClick={onSettings}>
            <Settings2 size={17} />
          </IconButton>
          <IconButton label="返回聊天" onClick={onChat}>
            <ArrowLeft size={17} />
          </IconButton>
        </div>
      </header>
      <div className="studio-subnav">
        <div className="segmented" role="tablist" aria-label="工作室页面">
          <button
            role="tab"
            aria-selected={tab === "generate"}
            className={cx(tab === "generate" && "active")}
            onClick={() => setTab("generate")}
          >
            <Sparkles size={15} />
            生图
          </button>
          <button
            role="tab"
            aria-selected={tab === "gallery"}
            className={cx(tab === "gallery" && "active")}
            onClick={() => {
              setTab("gallery");
              void refresh();
            }}
          >
            <Images size={15} />
            画廊
            <span className="tab-count">
              {jobs.filter((j) => j.images.length).length}
            </span>
          </button>
        </div>
        <span className="studio-subtitle">
          {tab === "generate"
            ? "让想象，有迹可循。"
            : `${jobs.reduce((n, j) => n + j.images.length, 0)} 张作品`}
        </span>
      </div>
      {loadError && (
        <div className="studio-load-error" role="alert">
          {loadError}
          <button className="button small" onClick={() => void refresh()}>
            重新加载
          </button>
        </div>
      )}
      {tab === "generate" ? (
        <div className="studio-layout">
          <section className="studio-controls" aria-label="生图参数">
            <Field label="生图模型">
              {models.length ? (
                <select
                  aria-label="工作室生图模型"
                  value={selected?.key || ""}
                  onChange={(e) => chooseModel(e.target.value)}
                >
                  {settings.imageProviders
                    .filter((p) => p.enabled)
                    .map((p) => (
                      <optgroup label={p.name} key={p.id}>
                        {p.models.map((m) => (
                          <option key={m} value={p.id + "::" + m}>
                            {m}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
              ) : (
                <button className="studio-connect" onClick={onSettings}>
                  <Plus size={16} />
                  连接生图供应商
                  <ArrowUpRight size={15} />
                </button>
              )}
            </Field>
            <Field label="画面描述">
              <textarea
                ref={textarea}
                aria-label="画面描述"
                className="studio-prompt"
                placeholder="描述画面、构图、光线和风格…"
                value={prompt}
                maxLength={32000}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    void generate();
                  }
                }}
              />
            </Field>
            <div className="studio-references">
              <div className="row between">
                <label>
                  参考图{" "}
                  <span className="muted">
                    {references.length}/{profile.maxReferences}
                  </span>
                </label>
                <button
                  className="text-button"
                  disabled={references.length >= profile.maxReferences}
                  onClick={() => file.current?.click()}
                >
                  <ImagePlus size={13} />
                  添加
                </button>
              </div>
              {references.length ? (
                <div className="reference-strip">
                  {references.map((a, i) => (
                    <div key={a.id + i}>
                      <img src={a.data} alt={a.name} />
                      <IconButton
                        label={`移除参考图 ${i + 1}`}
                        onClick={() =>
                          setReferences((current) =>
                            current.filter((_, n) => n !== i),
                          )
                        }
                      >
                        <X size={12} />
                      </IconButton>
                    </div>
                  ))}
                </div>
              ) : (
                <button
                  className="reference-dropzone"
                  disabled={!profile.maxReferences}
                  onClick={() => file.current?.click()}
                >
                  <ImagePlus size={20} />
                  <span>
                    {profile.maxReferences
                      ? "粘贴、拖入，或选择图片"
                      : "此模型仅支持文字生图"}
                  </span>
                </button>
              )}
              <input
                type="file"
                ref={file}
                hidden
                multiple
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  void addFiles([...(e.target.files || [])]).catch((e) =>
                    notify(e.message),
                  );
                  e.target.value = "";
                }}
              />
            </div>
            <div className="form-grid studio-options">
              <Field label={google ? "画面比例" : "图片尺寸"}>
                <select
                  aria-label="图片尺寸或比例"
                  value={profile.sizes.includes(size) ? size : "auto"}
                  onChange={(e) => setSize(e.target.value)}
                >
                  {profile.sizes.map((v) => (
                    <option key={v} value={v}>
                      {sizeLabel(v)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="生成数量">
                <select
                  aria-label="生成数量"
                  value={Math.min(count, profile.maxCount)}
                  disabled={profile.maxCount === 1}
                  onChange={(e) => setCount(Number(e.target.value))}
                >
                  {Array.from(
                    { length: profile.maxCount },
                    (_, i) => i + 1,
                  ).map((n) => (
                    <option key={n} value={n}>
                      {n} 张
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {!google && (
              <>
                <button
                  className="studio-advanced-button"
                  aria-expanded={advanced}
                  onClick={() => setAdvanced((v) => !v)}
                >
                  <SlidersHorizontal size={14} />
                  质量与背景<span>{advanced ? "收起" : "展开"}</span>
                </button>
                {advanced && (
                  <div className="form-grid studio-options">
                    <Field label="图像质量">
                      <select
                        aria-label="图像质量"
                        value={
                          profile.qualities.includes(quality) ? quality : "auto"
                        }
                        onChange={(e) => setQuality(e.target.value)}
                      >
                        {profile.qualities.map((v) => (
                          <option key={v} value={v}>
                            {
                              {
                                auto: "自动",
                                low: "快速草稿",
                                medium: "均衡",
                                high: "精细",
                                xhigh: "超精细",
                                max: "最高",
                                standard: "标准",
                                hd: "高清",
                              }[v]
                            }
                          </option>
                        ))}
                      </select>
                    </Field>
                    {profile.background && (
                      <Field label="图片背景">
                        <select
                          aria-label="图片背景"
                          value={background}
                          onChange={(e) => setBackground(e.target.value)}
                        >
                          <option value="auto">自动</option>
                          <option value="opaque">不透明</option>
                          <option value="transparent">透明</option>
                        </select>
                      </Field>
                    )}
                  </div>
                )}
              </>
            )}
            {referenceError && (
              <p className="studio-parameter-error" role="status">
                {referenceError}
              </p>
            )}
            <div className="studio-generate-area">
              {busy ? (
                <button
                  className="button studio-stop"
                  onClick={() => {
                    void bridge
                      .imageCancel(jobId)
                      .catch((e) => notify(e.message));
                  }}
                >
                  <Square size={14} />
                  停止生成
                </button>
              ) : (
                <button
                  className="button primary studio-generate"
                  disabled={
                    models.length > 0 && (!prompt.trim() || !!referenceError)
                  }
                  onClick={() => void generate()}
                >
                  <WandSparkles size={16} />
                  {models.length
                    ? references.length
                      ? "生成 · 使用参考图"
                      : "开始生成"
                    : "配置生图模型"}
                  <span>Ctrl ↵</span>
                </button>
              )}
            </div>
          </section>
          <section
            className="studio-results"
            aria-label="生成结果"
            aria-live="polite"
          >
            {busy && active?.id !== jobId ? (
              <div className="studio-progress">
                <Loader2 size={30} className="spin" />
                <h3>正在连接生图模型</h3>
                <p>可以切换到聊天，任务会继续运行。</p>
              </div>
            ) : active ? (
              <>
                <div className="studio-result-heading">
                  <div>
                    <span className={cx("job-status", active.status)}>
                      {active.status === "running" ? (
                        <Loader2 size={13} className="spin" />
                      ) : active.status === "done" ? (
                        <Check size={13} />
                      ) : (
                        <Clock3 size={13} />
                      )}
                      {statusText[active.status]}
                    </span>
                    <span className="muted text-xs">{active.model}</span>
                  </div>
                  <div className="row gap">
                    <IconButton
                      label={active.favorite ? "取消收藏" : "收藏作品"}
                      className={active.favorite ? "is-favorite" : ""}
                      onClick={() => void toggleFavorite(active)}
                    >
                      <Star
                        size={15}
                        fill={active.favorite ? "currentColor" : "none"}
                      />
                    </IconButton>
                    <IconButton
                      label="重用生成参数"
                      onClick={() => void reuse(active)}
                    >
                      <RotateCcw size={15} />
                    </IconButton>
                  </div>
                </div>
                {active.status === "running" && (
                  <div className="studio-progress">
                    <div className="studio-orbit">
                      <Sparkles size={28} />
                    </div>
                    <h3>灵感正在成形</h3>
                    <p>图片生成可能需要几分钟。</p>
                    <button
                      className="button small"
                      onClick={() =>
                        void bridge
                          .imageCancel(active.id)
                          .catch((e) => notify(e.message))
                      }
                    >
                      <Square size={12} />
                      停止任务
                    </button>
                  </div>
                )}
                {active.images.length > 0 && (
                  <div
                    className={cx(
                      "studio-output-grid",
                      active.images.length === 1 && "single",
                    )}
                  >
                    {active.images.map((asset, i) => (
                      <div className="studio-output" key={asset.id}>
                        <button
                          className="studio-output-open"
                          aria-label={`放大作品 ${i + 1}`}
                          onClick={() => setViewer({ job: active, index: i })}
                        >
                          <AssetImage asset={asset} alt={active.prompt} eager />
                          <span>
                            <Maximize2 size={17} />
                          </span>
                        </button>
                        <div className="studio-output-actions">
                          <button onClick={() => void addReference(asset)}>
                            <ImagePlus size={13} />
                            继续改图
                          </button>
                          <IconButton
                            label={`下载作品 ${i + 1}`}
                            onClick={() => void download(asset)}
                          >
                            <Download size={15} />
                          </IconButton>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {active.error && (
                  <div className="studio-task-error" role="status">
                    <strong>
                      {active.status === "cancelled"
                        ? "这次生成已停止"
                        : "这次生成未完成"}
                    </strong>
                    <p>{active.error}</p>
                    <button
                      className="button small"
                      onClick={() => void reuse(active)}
                    >
                      <RotateCcw size={13} />
                      重用参数
                    </button>
                  </div>
                )}
                <div className="studio-result-caption">
                  <p>{active.prompt}</p>
                  <div className="row gap wrap">
                    <span>
                      {active.size === "auto" ? "自动尺寸" : active.size}
                    </span>
                    <span>
                      {active.referenceCount
                        ? `${active.referenceCount} 张参考图`
                        : "文字生图"}
                    </span>
                    <span>
                      {active.source === "agent"
                        ? "来自 Agent"
                        : active.providerName}
                    </span>
                    {active.completedAt && (
                      <span>
                        {(
                          (active.completedAt - active.createdAt) /
                          1000
                        ).toFixed(1)}
                        s
                      </span>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="studio-empty">
                <div className="studio-empty-art">
                  <div className="art-mountain" />
                  <span className="art-sun" />
                  <span className="art-spark">
                    <Sparkles size={25} />
                  </span>
                </div>
                <span className="eyebrow">LUMEN STUDIO</span>
                <h2>把脑海里的，变成眼前的。</h2>
                <p>从一句描述开始，或给一张图片新的可能。</p>
                <div className="studio-example-list">
                  {examples.map((item, i) => (
                    <button
                      key={item.name}
                      onClick={() => {
                        setPrompt(item.prompt);
                        textarea.current?.focus();
                      }}
                    >
                      <span className={`example-swatch swatch-${i}`} />
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.tag}</small>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="studio-gallery">
          <div className="gallery-toolbar">
            <div className="gallery-search">
              <Search size={15} />
              <input
                aria-label="搜索画廊"
                placeholder="搜索描述、模型或供应商…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setLimit(24);
                }}
              />
            </div>
            <button
              className={cx("button small", favorites && "active-filter")}
              aria-pressed={favorites}
              onClick={() => {
                setFavorites((v) => !v);
                setLimit(24);
              }}
            >
              <Star size={14} fill={favorites ? "currentColor" : "none"} />
              收藏
            </button>
            <IconButton label="刷新画廊" onClick={() => void refresh()}>
              <RotateCcw size={15} />
            </IconButton>
          </div>
          {filtered.length ? (
            <>
              <div className="gallery-grid">
                {filtered.slice(0, limit).map((job) => (
                  <article className="gallery-card" key={job.id}>
                    <button
                      className="gallery-cover"
                      aria-label={`查看作品：${job.prompt.slice(0, 30)}`}
                      onClick={() => {
                        if (job.images.length) setViewer({ job, index: 0 });
                        else {
                          setJobId(job.id);
                          setTab("generate");
                        }
                      }}
                    >
                      {job.images[0] ? (
                        <AssetImage asset={job.images[0]} alt={job.prompt} />
                      ) : (
                        <span className="gallery-no-image">
                          {job.status === "running" ? (
                            <Loader2 size={24} className="spin" />
                          ) : (
                            <Images size={25} />
                          )}
                          <span>{statusText[job.status]}</span>
                        </span>
                      )}
                      {job.images.length > 1 && (
                        <span className="gallery-image-count">
                          {job.images.length} 张
                        </span>
                      )}
                      {job.source === "agent" && (
                        <span className="gallery-source">Agent</span>
                      )}
                    </button>
                    <div className="gallery-card-info">
                      <p title={job.prompt}>{job.prompt}</p>
                      <small>
                        {new Date(job.createdAt).toLocaleDateString("zh-CN")} ·{" "}
                        {job.model}
                      </small>
                      <div className="row between">
                        <button
                          className="text-button"
                          onClick={() => void reuse(job)}
                        >
                          <RotateCcw size={12} />
                          重用参数
                        </button>
                        <div className="row">
                          <IconButton
                            label={job.favorite ? "取消收藏" : "收藏作品"}
                            className={job.favorite ? "is-favorite" : ""}
                            onClick={() => void toggleFavorite(job)}
                          >
                            <Star
                              size={14}
                              fill={job.favorite ? "currentColor" : "none"}
                            />
                          </IconButton>
                          {job.status !== "running" && (
                            <IconButton
                              label="删除生成记录"
                              onClick={() => setDeleting(job)}
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {filtered.length > limit && (
                <button
                  className="button gallery-load-more"
                  onClick={() => setLimit((n) => n + 24)}
                >
                  加载更多 · 还有 {filtered.length - limit} 项
                </button>
              )}
            </>
          ) : (
            <div className="gallery-empty">
              <Images size={38} />
              <h3>
                {search || favorites
                  ? "没有找到作品"
                  : "你的灵感，会在这里相遇。"}
              </h3>
              <p>
                {search || favorites
                  ? "换个关键词，或查看全部作品。"
                  : "工作室与 Agent 生成的图片会自动收录。"}
              </p>
              <button
                className="button"
                onClick={() => {
                  setSearch("");
                  setFavorites(false);
                  if (!jobs.length) setTab("generate");
                }}
              >
                {jobs.length ? "查看全部" : "去创作第一张"}
              </button>
            </div>
          )}
        </div>
      )}
      {dragging && (
        <div className="studio-drop-overlay">
          <ImagePlus size={36} />
          <h3>放开，添加参考图</h3>
        </div>
      )}
      {viewer && (
        <ImageViewer
          assets={viewer.job.images}
          index={viewer.index}
          prompt={viewer.job.prompt}
          onClose={() => setViewer(undefined)}
          notify={notify}
          onReference={(asset) => void addReference(asset)}
        />
      )}
      {deleting && (
        <Modal title="删除生成记录" onClose={() => setDeleting(undefined)}>
          <div className="confirm-box">
            <Trash2 size={26} />
            <h3>删除这条生成记录？</h3>
            <p>同时删除本机图片，聊天中的关联图片将无法再查看。</p>
            <div className="row gap">
              <button className="button" onClick={() => setDeleting(undefined)}>
                取消
              </button>
              <button
                className="button danger"
                onClick={async () => {
                  try {
                    await bridge.imageRemove(deleting.id);
                    for (const a of [
                      ...deleting.images,
                      ...(deleting.references || []),
                    ])
                      forgetImageAsset(a.id);
                    setDeleting(undefined);
                    await refresh();
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                删除
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
