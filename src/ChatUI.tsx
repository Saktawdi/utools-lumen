import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronDown,
  Code2,
  Copy,
  FileText,
  Gauge,
  Globe2,
  ImagePlus,
  Loader2,
  Paperclip,
  Pencil,
  RotateCcw,
  ScanLine,
  Search,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { bridge } from "./bridge";
import { GeneratedImages } from "./ImageAssets";
import { Avatar } from "./Avatar";
import type {
  Attachment,
  Message,
  ModelConfig,
  Settings,
  StreamEvent,
  ToolInfo,
  ToolPermissionMode,
} from "./types";
import { IconButton, Logo, Toggle, cx, usePopoverDismiss } from "./ui";
import { formatTokenCount } from "./token-metrics";
export function Welcome({
  onPrompt,
  onAttach,
}: {
  onPrompt: (text: string) => void;
  onAttach: () => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome-symbol">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <Logo />
        <i className="orb-point" />
      </div>
      <h1>
        让想法，自由生长<span>。</span>
      </h1>
      <p>从一个问题、一张图片，或一瞬间的灵感开始。</p>
      <div className="prompt-grid">
        {[
          {
            icon: Pencil,
            title: "把想法写下来",
            description: "润色文字，让表达更清晰",
            prompt: "帮我润色一段文字，保留我的语气，让表达更清楚。",
          },
          {
            icon: Code2,
            title: "一起解决问题",
            description: "从一段代码，找到突破口",
            prompt:
              "我遇到了一个编程问题，请帮我分析原因并给出可执行的解决方法。",
          },
          {
            icon: Globe2,
            title: "探索新的可能",
            description: "搜索、比较，找到可靠答案",
            prompt:
              "我想研究一个话题，请先帮我梳理问题，再在需要时搜索并提供来源。",
          },
          {
            icon: ImagePlus,
            title: "换个角度看世界",
            description: "粘贴图片，细节也值得聊聊",
            prompt: "",
          },
        ].map((p) => (
          <button
            className="prompt-card"
            key={p.title}
            onClick={() => (p.prompt ? onPrompt(p.prompt) : onAttach())}
          >
            <span className="prompt-icon">
              <p.icon size={18} />
            </span>
            <strong>{p.title}</strong>
            <small>{p.description}</small>
            <span className="prompt-arrow">↗</span>
          </button>
        ))}
      </div>
    </div>
  );
}
export const Markdown = memo(function Markdown({
  content,
}: {
  content: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () =>
      DOMPurify.sanitize(
        marked.parse(content, {
          gfm: true,
          breaks: true,
          async: false,
        }) as string,
        {
          FORBID_TAGS: ["style", "iframe", "form", "input", "button"],
          FORBID_ATTR: ["style"],
          ADD_ATTR: ["target"],
        },
      ),
    [content],
  );
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    for (const pre of element.querySelectorAll("pre")) {
      if (pre.querySelector(".code-copy")) continue;
      const code = pre.querySelector("code");
      const button = document.createElement("button");
      button.className = "code-copy";
      button.textContent = "复制";
      button.setAttribute("aria-label", "复制代码");
      button.onclick = async () => {
        try {
          await navigator.clipboard.writeText(code?.textContent || "");
          button.textContent = "已复制";
          setTimeout(() => {
            button.textContent = "复制";
          }, 1600);
        } catch {
          button.textContent = "复制失败";
        }
      };
      pre.append(button);
    }
  }, [html]);
  return (
    <div
      ref={ref}
      className="markdown"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const link = (e.target as HTMLElement).closest("a");
        if (link) {
          e.preventDefault();
          if (/^https?:\/\//i.test(link.href)) bridge.openExternal(link.href);
        }
      }}
    />
  );
});
export const MessageView = memo(function MessageView({
  message: m,
  streaming,
  onRetry,
  onEdit,
  onImage,
  notify,
  userAvatar,
  agentAvatar,
}: {
  message: Message;
  streaming: boolean;
  onRetry: (messageId: string) => void;
  onEdit: (messageId: string) => void;
  onImage: (attachment: Attachment) => void;
  notify: (t: string) => void;
  userAvatar?: string;
  agentAvatar?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <article
      className={cx("message", m.role, streaming && "streaming")}
      aria-label={m.role === "user" ? "你的消息" : "Lumen 的回答"}
    >
      <div className="message-avatar">
        <Avatar
          role={m.role}
          src={m.role === "user" ? userAvatar : agentAvatar}
        />
      </div>
      <div className="message-body">
        <div className="message-bubble">
          {m.role === "assistant" && (
            <div className="message-author">
              Lumen <span>{m.model}</span>
              {streaming && <i className="status-dot online breathing" />}
            </div>
          )}
          {m.attachments?.length ? (
            <div className="message-attachments">
              {m.attachments.map((a) =>
                a.type === "image" ? (
                  <button
                    className="message-image"
                    key={a.id}
                    onClick={() => onImage(a)}
                  >
                    <img src={a.data} alt={a.name} />
                  </button>
                ) : (
                  <div className="file-attachment" key={a.id}>
                    <FileText size={19} />
                    <span>
                      {a.name}
                      <small>{formatBytes(a.size)}</small>
                    </span>
                  </div>
                ),
              )}
            </div>
          ) : null}
          {m.reasoning && (
            <details className="reasoning">
              <summary>
                <Sparkles size={14} />
                <span>{streaming ? "正在思考" : "思考过程"}</span>
                <ChevronDown size={13} />
              </summary>
              <div>{m.reasoning}</div>
            </details>
          )}
          {m.tools?.map((call) => (
            <details className={cx("tool-call", call.status)} key={call.id}>
              <summary>
                {call.status === "running" ? (
                  <Loader2 size={13} className="spin" />
                ) : call.status === "error" ? (
                  <AlertCircle size={13} />
                ) : (
                  <Check size={13} />
                )}
                <code>{call.name}</code>
                <span>
                  {call.status === "running"
                    ? "执行中"
                    : call.status === "error"
                      ? "未完成"
                      : "已完成"}
                </span>
                {call.duration !== undefined && (
                  <small>{(call.duration / 1000).toFixed(1)}s</small>
                )}
                <ChevronDown size={12} />
              </summary>
              <div>
                <strong>参数</strong>
                <pre>{prettyJson(call.arguments)}</pre>
                {call.result !== undefined && (
                  <>
                    <strong>结果</strong>
                    <pre>
                      {typeof call.result === "string"
                        ? call.result
                        : JSON.stringify(call.result, null, 2)}
                    </pre>
                  </>
                )}
              </div>
            </details>
          ))}
          {!!m.generatedImages?.length && (
            <GeneratedImages assets={m.generatedImages} notify={notify} />
          )}
          {m.content && (
            <div className="message-content">
              {m.role === "user" ? (
                <div className="user-text">{m.content}</div>
              ) : (
                <Markdown content={m.content} />
              )}
            </div>
          )}
          {streaming && !m.content && !m.reasoning && !m.tools?.length && (
            <div className="thinking-dots" aria-label="正在生成">
              <i />
              <i />
              <i />
            </div>
          )}
          {m.error && (
            <div className="message-error">
              <AlertCircle size={16} />
              <div>
                <strong>这次请求没有完成</strong>
                <p>{m.error}</p>
              </div>
            </div>
          )}
          {m.interrupted && <span className="interrupted">已停止生成</span>}
        </div>
        {!streaming && (
          <div className="message-actions">
            <IconButton
              label="复制消息"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(m.content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                } catch {
                  notify("无法访问剪贴板，请选择文本复制");
                }
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </IconButton>
            {m.role === "assistant" ? (
              <IconButton label="重新生成" onClick={() => onRetry(m.id)}>
                <RotateCcw size={13} />
              </IconButton>
            ) : (
              <IconButton label="编辑并重发" onClick={() => onEdit(m.id)}>
                <Pencil size={13} />
              </IconButton>
            )}
            {m.usage && (
              <span>
                {m.usage.input.toLocaleString()} 输入 ·{" "}
                {m.usage.output.toLocaleString()} 输出
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
function prettyJson(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
export function formatBytes(value: number) {
  return value >= 1024 * 1024
    ? `${(value / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(value / 1024))} KB`;
}
export function ToolsPopover({
  tools,
  onToggle,
  onClose,
  onSettings,
}: {
  tools: ToolInfo[];
  settings: Settings;
  onToggle: (names: string[], enabled: boolean) => void;
  onClose: () => void;
  onSettings: () => void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const popover = usePopoverDismiss<HTMLDivElement>(true, onClose);
  const rows = tools.filter((t) =>
    (t.name + " " + t.title + " " + t.description)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div ref={popover} className="popover tools-popover">
      <div className="popover-heading">
        <strong>
          <Wrench size={16} />
          工具箱 <span>{tools.filter((t) => t.enabled).length}</span>
        </strong>
        <IconButton label="关闭工具箱" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </div>
      <div className="tool-search">
        <Search size={14} />
        <input
          autoFocus
          aria-label="搜索工具"
          placeholder="搜索工具…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="tools-scroll">
        {[...new Set(rows.map((t) => t.group))].map((group) => {
          const grouped = rows.filter((t) => t.group === group);
          const enabled = grouped.every((t) => t.enabled);
          const isCollapsed = collapsed.includes(group);
          return (
            <div className="tool-group" key={group}>
              <div className="tool-group-heading">
                <button
                  onClick={() =>
                    setCollapsed(
                      isCollapsed
                        ? collapsed.filter((x) => x !== group)
                        : [...collapsed, group],
                    )
                  }
                >
                  <ChevronDown
                    size={14}
                    className={cx(isCollapsed && "rotate-left")}
                  />
                  <span>
                    <strong>{group}</strong>
                    <small>{grouped.map((t) => t.title).join("、")}</small>
                  </span>
                </button>
                <Toggle
                  label={`启用 ${group}`}
                  checked={enabled}
                  onChange={(value) =>
                    onToggle(
                      grouped
                        .filter((t) => t.name !== "list_tools")
                        .map((t) => t.name),
                      value,
                    )
                  }
                />
              </div>
              {!isCollapsed &&
                grouped.map((t) => (
                  <div className="tool-popover-row" key={t.name}>
                    <Wrench size={13} />
                    <span title={t.description}>
                      {t.title}
                      {t.approval && <ShieldCheck size={10} />}
                    </span>
                    <Toggle
                      label={`启用 ${t.title}`}
                      disabled={t.name === "list_tools"}
                      checked={t.enabled}
                      onChange={(value) => onToggle([t.name], value)}
                    />
                  </div>
                ))}
            </div>
          );
        })}
        {!rows.length && <div className="empty-inline">没有匹配的工具</div>}
      </div>
      <button className="picker-footer" onClick={onSettings}>
        <PlusIcon />
        注册与管理工具
        <ChevronDown size={13} />
      </button>
    </div>
  );
}
function PlusIcon() {
  return <span className="plus-text">+</span>;
}
export function Composer({
  draft,
  setDraft,
  attachments,
  onRemove,
  onFiles,
  onCapture,
  onPasteText,
  quickLabel,
  onCancelQuick,
  onSend,
  onStop,
  busy,
  settings,
  onToolPermissionChange,
  toolCount,
  toolsOpen,
  setToolsOpen,
  config,
  effort,
  setEffort,
  contextTokens,
  contextLimit,
  contextEstimated,
  outputRate,
  outputTokens,
  children,
  editing,
  onCancelEdit,
}: {
  draft: string;
  setDraft: (t: string) => void;
  attachments: Attachment[];
  onRemove: (id: string) => void;
  onFiles: (files: File[]) => void;
  onCapture: () => void;
  onPasteText: (text: string) => boolean;
  quickLabel?: string;
  onCancelQuick: () => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  settings: Settings;
  onToolPermissionChange: (mode: ToolPermissionMode) => void;
  toolCount: number;
  toolsOpen: boolean;
  setToolsOpen: (v: boolean) => void;
  config: ModelConfig;
  effort: string;
  setEffort: (v: string) => void;
  contextTokens: number;
  contextLimit?: number;
  contextEstimated: boolean;
  outputRate: number;
  outputTokens: number;
  children?: ReactNode;
  editing: boolean;
  onCancelEdit: () => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [reasoning, setReasoning] = useState(false);
  const reasoningAnchor = usePopoverDismiss<HTMLDivElement>(reasoning, () =>
    setReasoning(false),
  );
  const [custom, setCustom] = useState("");
  useEffect(() => {
    if (CSS.supports("field-sizing", "content")) return;
    const el = textarea.current;
    if (el) {
      el.style.height = "0px";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  }, [draft]);
  useEffect(() => {
    const focus = () => textarea.current?.focus();
    window.addEventListener("lumen-focus", focus);
    return () => window.removeEventListener("lumen-focus", focus);
  }, []);
  const levels = config.levels?.length
    ? config.levels
    : ["none", "low", "medium", "high"];
  const labels: Record<string, string> = {
    auto: "自动",
    none: "关闭",
    minimal: "极简",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "超高",
    max: "最大",
  };
  return (
    <div className="composer-wrap">
      {quickLabel && (
        <div className="quick-banner">
          <span>{quickLabel}</span>
          <button onClick={onCancelQuick} aria-label="退出快捷指令">
            <X size={13} />
          </button>
        </div>
      )}
      {editing && (
        <div className="edit-banner">
          <Pencil size={13} />
          正在编辑消息，发送后从这里继续。
          <button onClick={onCancelEdit}>取消</button>
        </div>
      )}
      <div
        className="composer"
        onClick={(e) => {
          if (e.target === e.currentTarget) textarea.current?.focus();
        }}
      >
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((a) => (
              <div className="attachment-preview" key={a.id}>
                {a.type === "image" ? (
                  <img src={a.data} alt={a.name} />
                ) : (
                  <FileText size={20} />
                )}
                <span>
                  {a.name}
                  <small>{formatBytes(a.size)}</small>
                </span>
                <IconButton
                  label={`移除附件 ${a.name}`}
                  onClick={() => onRemove(a.id)}
                >
                  <X size={12} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textarea}
          aria-label="消息输入框"
          rows={1}
          placeholder="给 Lumen 发消息，或粘贴一张图片…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              onFiles(files);
            } else if (onPasteText(e.clipboardData.getData("text/plain"))) {
              e.preventDefault();
            }
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              ((settings.sendKey === "enter" && !e.ctrlKey) ||
                (settings.sendKey === "ctrl-enter" && (e.ctrlKey || e.metaKey)))
            ) {
              e.preventDefault();
              if (!busy && (draft.trim() || attachments.length)) onSend();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-controls">
            <button
              className="composer-pill"
              onClick={() => fileRef.current?.click()}
              title="添加文本、代码或图片文件"
            >
              <Paperclip size={14} />
              <span>文件</span>
            </button>
            <button
              className="composer-pill"
              onClick={() => imageRef.current?.click()}
            >
              <ImagePlus size={14} />
              <span>图片</span>
            </button>
            <button
              className="composer-pill"
              title="框选截图并复制到剪贴板"
              onClick={onCapture}
            >
              <ScanLine size={14} />
              <span>截图</span>
            </button>
            <div className="popover-anchor">
              <button
                className={cx("composer-pill", toolsOpen && "active")}
                aria-expanded={toolsOpen}
                onClick={() => {
                  setToolsOpen(!toolsOpen);
                  setReasoning(false);
                }}
              >
                <Wrench size={14} />
                <span>工具</span>
                <b>{toolCount}</b>
              </button>
              {toolsOpen && children}
            </div>
            <span className="toolbar-divider" />
            <div ref={reasoningAnchor} className="popover-anchor">
              <button
                className={cx(
                  "composer-pill reasoning-button",
                  effort !== "auto" && "active",
                )}
                aria-expanded={reasoning}
                onClick={() => {
                  setReasoning(!reasoning);
                  setToolsOpen(false);
                }}
              >
                <Sparkles size={14} />
                <span>{labels[effort] || effort}</span>
                <ChevronDown size={11} />
              </button>
              {reasoning && (
                <div className="popover reasoning-popover">
                  <div className="popover-heading">
                    <strong>推理强度</strong>
                    <small>{config.source || "可自由输入"}</small>
                  </div>
                  {["auto", ...levels.filter((l) => l !== "auto")].map(
                    (level) => (
                      <button
                        className={cx(
                          "reasoning-option",
                          effort === level && "active",
                        )}
                        key={level}
                        onClick={() => {
                          setEffort(level);
                          setReasoning(false);
                        }}
                      >
                        <span>{labels[level] || level}</span>
                        <code>{level}</code>
                        {effort === level && <Check size={13} />}
                      </button>
                    ),
                  )}
                  <form
                    className="custom-effort"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (custom.trim()) {
                        setEffort(custom.trim());
                        setReasoning(false);
                      }
                    }}
                  >
                    <input
                      aria-label="自定义推理强度"
                      placeholder="自定义强度…"
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                    />
                    <button className="icon-button" aria-label="应用推理强度">
                      <Check size={14} />
                    </button>
                  </form>
                </div>
              )}
            </div>
            <button
              type="button"
              className={cx(
                "composer-pill permission-button",
                settings.toolPermission === "always_allow" && "active",
              )}
              aria-label={`工具权限：${settings.toolPermission === "always_allow" ? "Auto" : "每次询问"}`}
              aria-pressed={settings.toolPermission === "always_allow"}
              title={
                settings.toolPermission === "always_allow"
                  ? "切换为每次询问"
                  : "切换为 Auto，自动允许工具执行"
              }
              onClick={() => {
                setReasoning(false);
                setToolsOpen(false);
                onToolPermissionChange(
                  settings.toolPermission === "always_allow"
                    ? "prompt"
                    : "always_allow",
                );
              }}
            >
              {settings.toolPermission === "always_allow" ? (
                <ShieldCheck size={14} />
              ) : (
                <ShieldQuestion size={14} />
              )}
              <span>
                {settings.toolPermission === "always_allow"
                  ? "Auto"
                  : "每次询问"}
              </span>
            </button>
          </div>
          {busy ? (
            <button
              className="send-button stop"
              aria-label="停止生成"
              onClick={onStop}
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-button"
              aria-label="发送消息"
              disabled={!draft.trim() && !attachments.length}
              onClick={onSend}
            >
              <ArrowUp size={19} />
            </button>
          )}
        </div>
      </div>
      <div className="composer-metrics" aria-label="会话实时统计">
        <div
          className="composer-metric context-metric"
          title={
            contextLimit
              ? `${contextEstimated ? "估算" : "已上报"}上下文：${contextTokens.toLocaleString()} / ${contextLimit.toLocaleString()} tokens`
              : `${contextEstimated ? "估算" : "已上报"}上下文：${contextTokens.toLocaleString()} tokens；当前模型未提供上下文上限`
          }
        >
          <svg
            className={cx(
              "context-meter",
              contextLimit && contextTokens >= contextLimit * 0.9
                ? "near-limit"
                : undefined,
            )}
            viewBox="0 0 16 16"
            role="img"
            aria-label={
              contextLimit
                ? `上下文占用 ${Math.round((contextTokens / contextLimit) * 100)}%`
                : "上下文上限未知"
            }
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              opacity="0.22"
            />
            {!!contextLimit && (
              <circle
                cx="8"
                cy="8"
                r="6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                pathLength="100"
                strokeDasharray={`${Math.min(100, Math.max(0, (contextTokens / contextLimit) * 100))} 100`}
                transform="rotate(-90 8 8)"
              />
            )}
          </svg>
          <span className="composer-metric-copy">
            <strong>
              <span className="metric-label">上下文 </span>
              {contextEstimated && "≈"}
              {formatTokenCount(contextTokens)}
              {contextLimit
                ? ` / ${formatTokenCount(contextLimit)}`
                : " tokens"}
            </strong>
          </span>
        </div>
        <span className="composer-metric-divider" aria-hidden="true" />
        <div
          className={cx("composer-metric", outputRate > 0 && "metric-live")}
          title={`${outputTokens.toLocaleString()} 输出 tokens · ${outputRate > 0 ? `${outputRate.toFixed(1)} tokens/s` : "等待输出"}`}
        >
          <Gauge size={12} strokeWidth={1.7} />
          <span className="composer-metric-copy">
            <strong>
              {outputRate > 0 ? `${outputRate.toFixed(1)} tok/s` : "— tok/s"}
            </strong>
          </span>
        </div>
      </div>
      <input
        hidden
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.css,.xml,.yaml,.yml,.log,.sql,.sh,.toml"
        onChange={(e) => {
          onFiles([...(e.target.files || [])]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={imageRef}
        type="file"
        multiple
        accept="image/*"
        onChange={(e) => {
          onFiles([...(e.target.files || [])]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
export function ApprovalCard({
  event,
  onApprove,
}: {
  event: StreamEvent;
  onApprove: (allow: boolean) => void;
}) {
  return (
    <div className="approval-card">
      <span className="feature-icon">
        <ShieldCheck size={21} />
      </span>
      <div>
        <strong>允许执行 {event.name}？</strong>
        <p>这次调用会使用以下参数。</p>
        <pre>{JSON.stringify(event.args, null, 2)}</pre>
        <div className="row gap">
          <button
            className="button primary small"
            onClick={() => onApprove(true)}
          >
            允许这一次
          </button>
          <button className="button small" onClick={() => onApprove(false)}>
            拒绝
          </button>
        </div>
      </div>
    </div>
  );
}
