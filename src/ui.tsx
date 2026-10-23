import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { ModelConfig, ModelEntry, Provider } from "./types";
export const cx = (...classes: (string | false | undefined | null)[]) =>
  classes.filter(Boolean).join(" ");
export function usePopoverDismiss<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const pointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return ref;
}
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={cx("logo", small && "small")}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20 5c1.8 8.6 6.4 13.2 15 15-8.6 1.8-13.2 6.4-15 15C18.2 26.4 13.6 21.8 5 20 13.6 18.2 18.2 13.6 20 5Z"
        fill="currentColor"
      />
      <path
        d="M29 4c.6 3.4 2.6 5.4 6 6-3.4.6-5.4 2.6-6 6-.6-3.4-2.6-5.4-6-6 3.4-.6 5.4-2.6 6-6Z"
        fill="currentColor"
        opacity=".42"
      />
    </svg>
  );
}
export function IconButton({
  label,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      type="button"
      className={cx("icon-button", className)}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx("toggle", checked && "on")}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
const modalStack: HTMLDivElement[] = [];
export function Modal({
  children,
  title,
  onClose,
  wide = false,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    if (dialog) modalStack.push(dialog);
    dialog?.focus();
    const handle = (e: KeyboardEvent) => {
      if (modalStack.at(-1) !== dialog) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === "Tab" && dialog) {
        const els = [
          ...dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ),
        ].filter((el) => el.offsetParent !== null);
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || document.activeElement === dialog)
        ) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle, true);
    return () => {
      if (dialog) {
        const index = modalStack.indexOf(dialog);
        if (index >= 0) modalStack.splice(index, 1);
      }
      document.removeEventListener("keydown", handle, true);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={cx("modal", wide && "wide")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {children}
      </div>
    </div>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function CapabilityTags({ config }: { config: ModelConfig }) {
  return (
    <span className="capability-tags">
      {config.vision && <i>视觉</i>}
      {config.reasoning && <i>思考</i>}
      {config.tools && <i>工具</i>}
      {config.context && (
        <i>
          {config.context >= 1000000
            ? `${Math.floor(config.context / 1000000)}M`
            : `${Math.round(config.context / 1000)}K`}
        </i>
      )}
    </span>
  );
}
export function parseKeys(raw: string): string[] {
  let values: unknown[];
  if (/^\s*[\[{"]|^\s*(null|true|false)\s*$/.test(raw)) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("密钥 JSON 格式无效，请使用字符串数组或每行一个密钥");
    }
    values = Array.isArray(data)
      ? data
      : data &&
          typeof data === "object" &&
          Array.isArray((data as { keys?: unknown }).keys)
        ? (data as { keys: unknown[] }).keys
        : [data];
  } else {
    values = raw.split(/[\n,;\t]+/);
  }
  const normalized = values
    .map((value) => {
      const key =
        typeof value === "string"
          ? value
          : value && typeof value === "object"
            ? ((value as Record<string, unknown>).key ??
              (value as Record<string, unknown>).apiKey)
            : undefined;
      if (typeof key !== "string")
        throw new Error("密钥条目需要字符串或包含 key / apiKey 的对象");
      return key
        .trim()
        .replace(/^Bearer\s+/i, "")
        .replace(/^['"]|['"]$/g, "")
        .trim();
    })
    .filter(Boolean);
  if (!normalized.length) throw new Error("没有找到可导入的密钥");
  return [...new Set(normalized)];
}
export function KeysEditor({
  keys,
  onChange,
}: {
  keys: string[];
  onChange: (keys: string[]) => void;
}) {
  const [raw, setRaw] = useState("");
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const importKeys = (text: string) => {
    onChange([...new Set([...keys, ...parseKeys(text)])]);
    setError("");
    setRaw("");
    setExpanded(false);
  };
  return (
    <div className="keys-editor">
      <div className="field-label">
        <span>
          <KeyRound size={14} /> API 密钥{" "}
          <small>{keys.length} 个 · 轮询使用</small>
        </span>
        <button className="text-button" onClick={() => setExpanded(!expanded)}>
          <Plus size={13} />
          批量导入
        </button>
      </div>
      {keys.length > 0 && (
        <div className="key-list">
          {keys.map((key, i) => (
            <div className="key-row" key={key}>
              <span className="key-index">
                {String(i + 1).padStart(2, "0")}
              </span>
              <code>
                {show
                  ? key
                  : key.length > 12
                    ? `${key.slice(0, 5)}${"•".repeat(16)}${key.slice(-4)}`
                    : "•".repeat(16)}
              </code>
              <IconButton
                label="移除此密钥"
                onClick={() => onChange(keys.filter((_, j) => j !== i))}
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))}
          <button className="text-button muted" onClick={() => setShow(!show)}>
            {show ? <EyeOff size={13} /> : <Eye size={13} />}{" "}
            {show ? "隐藏密钥" : "显示密钥"}
          </button>
        </div>
      )}
      {(!keys.length || expanded) && (
        <>
          <textarea
            aria-label="批量密钥"
            className={cx("key-input", !show && "secret-input")}
            rows={3}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={"粘贴多个密钥，每行一个\n也支持逗号分隔或 JSON 数组"}
          />
          <div className="row between">
            <button
              className="text-button"
              onClick={() => input.current?.click()}
            >
              从 TXT / JSON 导入
            </button>
            <button
              className="button small"
              disabled={!raw.trim()}
              onClick={() => {
                try {
                  importKeys(raw);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Plus size={13} />
              导入密钥
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="approval-hint" role="alert">
          {error}
        </p>
      )}
      <input
        hidden
        type="file"
        ref={input}
        accept=".txt,.json"
        onChange={async (e) => {
          try {
            const file = e.target.files?.[0];
            if (file) importKeys(await file.text());
          } catch (error) {
            setError((error as Error).message);
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}
export function ModelPicker({
  entries,
  selected,
  onSelect,
  onSettings,
  onClose,
}: {
  entries: ModelEntry[];
  selected?: string;
  onSelect: (key: string) => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const popover = usePopoverDismiss<HTMLDivElement>(true, onClose);
  const rows = entries.filter((x) =>
    (x.id + " " + x.provider.name).toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => setIndex(0), [query]);
  return (
    <div
      ref={popover}
      className="popover model-picker"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setIndex((i) => Math.min(rows.length - 1, i + 1));
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setIndex((i) => Math.max(0, i - 1));
        }
        if (e.key === "Enter" && rows[index]) onSelect(rows[index].key);
      }}
    >
      <input
        autoFocus
        aria-label="搜索启动模型"
        placeholder="搜索模型或供应商…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="picker-scroll">
        {!rows.length && (
          <div className="empty-inline">
            {entries.length
              ? "没有匹配的模型"
              : "先添加供应商，选择你的启动模型。"}
          </div>
        )}
        {rows.map((m, i) => (
          <button
            key={m.key}
            onMouseEnter={() => setIndex(i)}
            className={cx("model-option", index === i && "focused")}
            onClick={() => onSelect(m.key)}
          >
            <span className="model-monogram">{m.id[0].toUpperCase()}</span>
            <span className="model-option-main">
              <strong>{m.id}</strong>
              <small>{m.provider.name}</small>
              <CapabilityTags config={m.config} />
            </span>
            {m.key === selected && <Check size={16} className="accent" />}
          </button>
        ))}
      </div>
      <button className="picker-footer" onClick={onSettings}>
        <Plus size={15} />
        管理供应商与启动模型
        <ChevronDown size={13} />
      </button>
    </div>
  );
}
export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <IconButton label="关闭" onClick={onClose}>
      <X size={18} />
    </IconButton>
  );
}
export function providerEntries(providers: Provider[]): ModelEntry[] {
  return providers
    .filter((p) => p.enabled)
    .flatMap((p) =>
      p.models.map((id) => ({
        key: p.id + "::" + id,
        id,
        provider: p,
        config: p.modelConfigs[id] || {},
      })),
    );
}
