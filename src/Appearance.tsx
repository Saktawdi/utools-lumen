import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ImagePlus,
  Loader2,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  Sun,
  Trash2,
} from "lucide-react";
import { Avatar } from "./Avatar";
import { readAppearanceImage, skinVariables } from "./appearance-utils";
import { bridge } from "./bridge";
import { skins as builtInSkins } from "./defaults";
import { parseSkin } from "./state-data";
import type { Settings, Skin } from "./types";
import { Field, IconButton, Toggle, cx } from "./ui";

type Update = (
  patch: Partial<Settings> | ((current: Settings) => Partial<Settings>),
) => void;
const imageTypes = "image/png,image/jpeg,image/webp,image/avif,image/gif";

export default function Appearance({
  settings,
  update,
  notify,
}: {
  settings: Settings;
  update: Update;
  notify: (text: string) => void;
}) {
  const skin =
    settings.skins.find((s) => s.id === settings.skin) || settings.skins[0];
  const [previewDark, setPreviewDark] = useState(
    settings.theme === "dark" ||
      (settings.theme === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches),
  );
  const [uploading, setUploading] = useState(false);
  const [removeId, setRemoveId] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const backgroundRef = useRef<HTMLInputElement>(null);
  const custom = skin.custom || !builtInSkins.some((s) => s.id === skin.id);

  const patchSkin = (patch: Partial<Skin>, id = skin.id) =>
    update((current) => ({
      skins: current.skins.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  const customize = () => {
    const copy: Skin = {
      ...skin,
      id: `custom-${crypto.randomUUID()}`,
      name: `${skin.name} · 自定义`,
      description: "我的专属皮肤",
      custom: true,
    };
    update((current) => ({ skins: [...current.skins, copy], skin: copy.id }));
  };
  const colorKeys = previewDark
    ? ({
        accent: "darkAccent",
        background: "darkBackground",
        user: "darkUserBubble",
        agent: "darkAgentBubble",
      } as const)
    : ({
        accent: "accent",
        background: "background",
        user: "userBubble",
        agent: "agentBubble",
      } as const);

  return (
    <div className="settings-section appearance-settings">
      <h3>显示模式</h3>
      <div className="theme-options">
        {(
          [
            { id: "light", label: "浅色", icon: Sun },
            { id: "dark", label: "深色", icon: Moon },
            { id: "system", label: "跟随系统", icon: Monitor },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            className={cx("theme-card", t.id === settings.theme && "active")}
            aria-pressed={t.id === settings.theme}
            onClick={() => {
              update({ theme: t.id });
              setPreviewDark(
                t.id === "dark" ||
                  (t.id === "system" &&
                    matchMedia("(prefers-color-scheme: dark)").matches),
              );
            }}
          >
            <div className={`theme-preview ${t.id}`}>
              <span />
              <span />
              <span />
            </div>
            <span>
              <t.icon size={15} />
              {t.label}
              {settings.theme === t.id && <Check size={13} />}
            </span>
          </button>
        ))}
      </div>

      <div className="section-divider" />
      <div className="appearance-row">
        <h3>聊天布局</h3>
        <div className="segmented" role="group" aria-label="聊天布局">
          <button
            aria-pressed={settings.chatLayout === "split"}
            className={cx(settings.chatLayout === "split" && "active")}
            onClick={() => update({ chatLayout: "split" })}
          >
            双侧 · 用户在右
          </button>
          <button
            aria-pressed={settings.chatLayout === "single"}
            className={cx(settings.chatLayout === "single" && "active")}
            onClick={() => update({ chatLayout: "single" })}
          >
            单侧
          </button>
        </div>
      </div>
      <div className="avatar-settings">
        <AvatarPicker
          label="你的头像"
          role="user"
          src={settings.userAvatar}
          onChange={(userAvatar) => update({ userAvatar })}
          notify={notify}
        />
        <AvatarPicker
          label="Agent 头像"
          role="assistant"
          src={settings.agentAvatar}
          onChange={(agentAvatar) => update({ agentAvatar })}
          notify={notify}
        />
      </div>

      <div className="section-divider" />
      <div className="appearance-row skin-heading">
        <h3>皮肤库</h3>
        <div className="row gap">
          <button
            className="text-button"
            onClick={() => importRef.current?.click()}
          >
            <ArrowUpFromLine size={13} />
            导入
          </button>
          <button
            className="text-button"
            onClick={() =>
              void bridge
                .exportFile("lumen-skin.json", JSON.stringify(skin, null, 2))
                .catch((e: Error) => notify(e.message))
            }
          >
            <ArrowDownToLine size={13} />
            导出
          </button>
        </div>
      </div>
      <div className="skin-grid">
        {settings.skins.map((s) => (
          <button
            key={s.id}
            className={cx("skin-card", settings.skin === s.id && "active")}
            aria-pressed={settings.skin === s.id}
            onClick={() => {
              update({ skin: s.id });
              setRemoveId("");
            }}
          >
            <div
              className="skin-swatch"
              style={{ background: s.background || "#f6f8f6" }}
            >
              {s.backgroundImage && (
                <img
                  className="skin-swatch-image"
                  src={s.backgroundImage}
                  alt=""
                  loading="lazy"
                />
              )}
              <i style={{ background: s.accent }} />
              <i style={{ background: s.darkAccent }} />
              <i style={{ background: s.darkBackground || "#202421" }} />
              {settings.skin === s.id && (
                <span style={{ color: s.accent }}>
                  <Check size={15} />
                </span>
              )}
            </div>
            <strong>{s.name}</strong>
          </button>
        ))}
        <button className="skin-card create-skin" onClick={customize}>
          <Plus size={19} />
          <strong>自定义皮肤</strong>
        </button>
      </div>
      <input
        ref={importRef}
        hidden
        type="file"
        accept=".json"
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (!file) return;
          try {
            if (file.size > 5 * 1024 * 1024)
              throw new Error("皮肤文件需小于 5 MB");
            const imported = {
              ...parseSkin(JSON.parse(await file.text())),
              id: `custom-${crypto.randomUUID()}`,
              custom: true,
            };
            update((current) => ({
              skins: [...current.skins, imported],
              skin: imported.id,
            }));
            notify("皮肤已导入");
          } catch (e) {
            notify((e as Error).message);
          }
        }}
      />

      <div className="preference-row">
        <strong>紧凑布局</strong>
        <Toggle
          label="紧凑布局"
          checked={settings.compact}
          onChange={(compact) => update({ compact })}
        />
      </div>
      <div className="appearance-row preview-heading">
        <span className="muted text-xs">即时预览</span>
        <div className="segmented small" role="group" aria-label="皮肤预览模式">
          <button
            className={cx(!previewDark && "active")}
            aria-pressed={!previewDark}
            onClick={() => setPreviewDark(false)}
          >
            浅色
          </button>
          <button
            className={cx(previewDark && "active")}
            aria-pressed={previewDark}
            onClick={() => setPreviewDark(true)}
          >
            深色
          </button>
        </div>
      </div>
      <div
        className="appearance-preview"
        data-preview-theme={previewDark ? "dark" : "light"}
        data-layout={settings.chatLayout}
        data-bubbles={skin.bubbleStyle || "soft"}
        style={skinVariables(skin, previewDark) as CSSProperties}
        aria-label="聊天外观预览"
      >
        <div className="chat-backdrop" aria-hidden="true" />
        <div className="message user">
          <div className="message-avatar">
            <Avatar role="user" src={settings.userAvatar} />
          </div>
          <div className="message-body">
            <div className="message-bubble">
              <div className="user-text">让这里，成为你的空间。</div>
            </div>
          </div>
        </div>
        <div className="message assistant">
          <div className="message-avatar">
            <Avatar role="assistant" src={settings.agentAvatar} />
          </div>
          <div className="message-body">
            <div className="message-bubble">
              <div className="message-author">Lumen</div>
              <div className="markdown">从一个想法开始，一起慢慢展开。</div>
            </div>
          </div>
        </div>
      </div>

      {!custom ? (
        <button className="button customize-button" onClick={customize}>
          <Plus size={14} />
          以此为基础定制
        </button>
      ) : (
        <div className="skin-editor" key={skin.id}>
          <div className="appearance-row">
            <h3>自定义</h3>
            <div className="row gap">
              <button
                className="text-button"
                onClick={() =>
                  patchSkin({
                    backgroundImage: undefined,
                    backgroundBlur: undefined,
                    backgroundOpacity: undefined,
                    backgroundPosition: undefined,
                    bubbleStyle: undefined,
                    bubbleRadius: undefined,
                    bubbleOpacity: undefined,
                    userBubble: undefined,
                    darkUserBubble: undefined,
                    agentBubble: undefined,
                    darkAgentBubble: undefined,
                  })
                }
              >
                <RotateCcw size={12} />
                重置效果
              </button>
              <IconButton
                label="删除此自定义皮肤"
                onClick={() => setRemoveId(skin.id)}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          </div>
          {removeId === skin.id && (
            <div className="skin-remove-confirm">
              <span>移除此皮肤？</span>
              <button className="text-button" onClick={() => setRemoveId("")}>
                取消
              </button>
              <button
                className="text-button danger"
                onClick={() => {
                  update((current) => {
                    const remaining = current.skins.filter(
                      (s) => s.id !== skin.id,
                    );
                    const next = remaining.length ? remaining : builtInSkins;
                    return { skins: next, skin: next[0].id };
                  });
                  setRemoveId("");
                }}
              >
                移除
              </button>
            </div>
          )}
          <SkinName
            key={skin.id}
            name={skin.name}
            onChange={(name) => patchSkin({ name })}
          />
          <div className="appearance-row">
            <strong className="setting-label">背景图片</strong>
            <div className="row gap">
              <button
                className="text-button"
                disabled={uploading}
                onClick={() => backgroundRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <ImagePlus size={14} />
                )}
                {skin.backgroundImage ? "更换图片" : "选择本地图片"}
              </button>
              {skin.backgroundImage && (
                <button
                  className="text-button"
                  onClick={() => patchSkin({ backgroundImage: undefined })}
                >
                  清除
                </button>
              )}
            </div>
          </div>
          <input
            ref={backgroundRef}
            hidden
            type="file"
            accept={imageTypes}
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (!file) return;
              const targetId = skin.id;
              setUploading(true);
              try {
                patchSkin(
                  {
                    backgroundImage: await readAppearanceImage(
                      file,
                      "background",
                    ),
                  },
                  targetId,
                );
              } catch (error) {
                notify((error as Error).message);
              } finally {
                setUploading(false);
              }
            }}
          />
          {skin.backgroundImage && (
            <>
              <Range
                label="高斯模糊"
                value={skin.backgroundBlur ?? 12}
                min={0}
                max={32}
                unit="px"
                onChange={(backgroundBlur) => patchSkin({ backgroundBlur })}
              />
              <Range
                label="图片显隐"
                value={Math.round((skin.backgroundOpacity ?? 0.18) * 100)}
                min={0}
                max={100}
                unit="%"
                onChange={(v) => patchSkin({ backgroundOpacity: v / 100 })}
              />
              <Field label="图片位置">
                <select
                  aria-label="图片位置"
                  value={skin.backgroundPosition || "center"}
                  onChange={(e) =>
                    patchSkin({
                      backgroundPosition: e.target
                        .value as Skin["backgroundPosition"],
                    })
                  }
                >
                  <option value="center">居中</option>
                  <option value="top">顶部</option>
                  <option value="bottom">底部</option>
                </select>
              </Field>
            </>
          )}
          <div className="appearance-row bubble-style-row">
            <strong className="setting-label">气泡样式</strong>
            <div className="segmented" role="group" aria-label="气泡样式">
              {(
                [
                  { id: "soft", label: "柔和" },
                  { id: "outline", label: "描边" },
                  { id: "minimal", label: "简约" },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  className={cx(
                    (skin.bubbleStyle || "soft") === s.id && "active",
                  )}
                  aria-pressed={(skin.bubbleStyle || "soft") === s.id}
                  onClick={() => patchSkin({ bubbleStyle: s.id })}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <Range
            label="气泡圆角"
            value={skin.bubbleRadius ?? 18}
            min={0}
            max={28}
            unit="px"
            onChange={(bubbleRadius) => patchSkin({ bubbleRadius })}
          />
          {skin.bubbleStyle !== "minimal" && (
            <Range
              label="气泡不透明度"
              value={Math.round((skin.bubbleOpacity ?? 0.96) * 100)}
              min={45}
              max={100}
              unit="%"
              onChange={(v) => patchSkin({ bubbleOpacity: v / 100 })}
            />
          )}
          <details className="skin-colors">
            <summary>{previewDark ? "深色" : "浅色"}配色</summary>
            <div className="color-grid">
              <Color
                label="强调色"
                value={skin[colorKeys.accent]}
                onChange={(v) => patchSkin({ [colorKeys.accent]: v })}
              />
              <Color
                label="画布"
                value={
                  skin[colorKeys.background] ||
                  (previewDark ? "#1d211f" : "#fafbf9")
                }
                onChange={(v) => patchSkin({ [colorKeys.background]: v })}
              />
              <Color
                label="用户气泡"
                value={
                  skin[colorKeys.user] || (previewDark ? "#303e35" : "#eaf3ee")
                }
                onChange={(v) => patchSkin({ [colorKeys.user]: v })}
              />
              <Color
                label="Agent 气泡"
                value={
                  skin[colorKeys.agent] || (previewDark ? "#272c29" : "#ffffff")
                }
                onChange={(v) => patchSkin({ [colorKeys.agent]: v })}
              />
            </div>
          </details>
        </div>
      )}
      <div className="section-divider" />
      <div className="preference-row">
        <strong>减少动态效果</strong>
        <Toggle
          label="减少动态效果"
          checked={settings.reduceMotion}
          onChange={(reduceMotion) => update({ reduceMotion })}
        />
      </div>
    </div>
  );
}

function SkinName({
  name,
  onChange,
}: {
  name: string;
  onChange: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  return (
    <Field label="皮肤名称">
      <input
        aria-label="皮肤名称"
        value={draft}
        maxLength={40}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(e.target.value.trim() || "自定义皮肤");
        }}
        onBlur={() => setDraft(draft.trim() || "自定义皮肤")}
      />
    </Field>
  );
}

function AvatarPicker({
  label,
  role,
  src,
  onChange,
  notify,
}: {
  label: string;
  role: "user" | "assistant";
  src?: string;
  onChange: (value?: string) => void;
  notify: (t: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="avatar-picker">
      <Avatar role={role} src={src} />
      <div>
        <strong>{label}</strong>
        <div className="row gap">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? "处理中…" : "选择图片"}
          </button>
          {src && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => onChange(undefined)}
            >
              恢复默认
            </button>
          )}
        </div>
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept={imageTypes}
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (!file) return;
          setBusy(true);
          try {
            onChange(await readAppearanceImage(file, "avatar"));
          } catch (error) {
            notify((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
function Range({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="appearance-range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>
        {value}
        {unit}
      </output>
    </label>
  );
}
function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="appearance-color">
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span>{label}</span>
      <code>{value}</code>
    </label>
  );
}
