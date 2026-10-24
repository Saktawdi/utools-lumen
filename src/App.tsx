import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronRight,
  Command,
  Ellipsis,
  Loader2,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SquarePen,
  Sun,
  Trash2,
  X,
  WandSparkles,
} from "lucide-react";
import { bridge, mergeState } from "./bridge";
import { skinVariables } from "./appearance-utils";
import { agentSettings } from "./state-data";
import { freshState } from "./defaults";
import Settings from "./Settings";
import { languageName, quickRequest } from "./quick-commands";
import type { QuickAction } from "./quick-commands";
import type { SettingsTab } from "./Settings";
import type {
  AppState,
  Attachment,
  Conversation,
  Message,
  ModelEntry,
  PluginEntry,
  StreamEvent,
  ToolPermissionMode,
  ToolInfo,
} from "./types";
import { estimateContextTokens, estimateTextTokens } from "./token-metrics";
import {
  ApprovalCard,
  Composer,
  MessageView,
  ToolsPopover,
  Welcome,
} from "./ChatUI";
import {
  CapabilityTags,
  IconButton,
  Logo,
  Modal,
  ModelPicker,
  cx,
  providerEntries,
} from "./ui";
const id = () => crypto.randomUUID();
const Studio = lazy(() => import("./Studio"));
const makeConversation = (): Conversation => ({
  id: id(),
  title: "新对话",
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
type StreamMetrics = {
  conversationId?: string;
  outputTokens: number;
  outputRate: number;
  active: boolean;
};
export default function App() {
  const [state, setState] = useState<AppState>(freshState);
  const stateRef = useRef(state);
  const [ready, setReady] = useState(false);
  const [darkTheme, setDarkTheme] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [draft, setDraft] = useState("");
  const [quickAction, setQuickAction] = useState<QuickAction>();
  const [pendingEntry, setPendingEntry] = useState<PluginEntry>();
  const entryHandler = useRef<(entry: PluginEntry) => Promise<void>>(
    async () => {},
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("providers");
  const [baseTools, setBaseTools] = useState<ToolInfo[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebar, setSidebar] = useState(true);
  const [view, setView] = useState<"chat" | "studio">("chat");
  const [studioVisited, setStudioVisited] = useState(false);
  const [modelKey, setModelKey] = useState("");
  const [effort, setEffort] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [streamMetrics, setStreamMetrics] = useState<StreamMetrics>({
    outputTokens: 0,
    outputRate: 0,
    active: false,
  });
  const streamMetricsRef = useRef<{
    startedAt: number;
    outputTokens: number;
    reportedOutput?: number;
  }>({ startedAt: 0, outputTokens: 0 });
  const [streamId, setStreamId] = useState("");
  const [streamConversation, setStreamConversation] = useState("");
  const [approval, setApproval] = useState<StreamEvent>();
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [image, setImage] = useState<Attachment>();
  const [dragging, setDragging] = useState(false);
  const dragCount = useRef(0);
  const [menu, setMenu] = useState("");
  const [rename, setRename] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [edit, setEdit] = useState<{ conversation: string; index: number }>();
  const [atBottom, setAtBottom] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const tail = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const saving = useRef<Promise<void> | undefined>(undefined);
  const loading = useRef(false);
  const sending = useRef(false);
  const settings = state.settings;
  const activeSkin = useMemo(
    () =>
      settings.skins.find((skin) => skin.id === settings.skin) ||
      settings.skins[0],
    [settings.skin, settings.skins],
  );
  const active = state.conversations.find((c) => c.id === state.activeId);
  const entries = useMemo(
    () => providerEntries(settings.providers),
    [settings.providers],
  );
  const selected =
    entries.find((m) => m.key === (active?.modelKey || modelKey)) ||
    entries.find((m) => m.key === settings.defaultModel) ||
    entries[0];
  const lastMessage = active
    ? active.messages[active.messages.length - 1]
    : undefined;
  const estimatedContext = useMemo(
    () => estimateContextTokens(active?.messages || []),
    [
      active?.id,
      active?.messages.length,
      lastMessage?.id,
      lastMessage?.usage?.input,
    ],
  );
  const contextMetrics = useMemo(() => {
    const reportedInput =
      lastMessage?.role === "assistant" ? lastMessage.usage?.input : undefined;
    const pendingReply =
      busy &&
      streamConversation === active?.id &&
      !!streamId &&
      lastMessage?.id === streamId &&
      lastMessage !== undefined &&
      !lastMessage.usage;
    return {
      tokens:
        typeof reportedInput === "number" && reportedInput > 0 && !pendingReply
          ? reportedInput
          : estimatedContext,
      estimated:
        !(typeof reportedInput === "number" && reportedInput > 0) ||
        pendingReply,
      limit: selected?.config.context,
    };
  }, [
    active?.id,
    busy,
    estimatedContext,
    lastMessage?.id,
    lastMessage?.role,
    lastMessage?.usage?.input,
    selected?.config.context,
    streamConversation,
    streamId,
  ]);
  const notify = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }, []);
  const openSettings = useCallback((tab: SettingsTab = "providers") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
    setModelOpen(false);
    setToolsOpen(false);
  }, []);
  const update = useCallback(
    (updater: AppState | ((s: AppState) => AppState)) => {
      // Keep the persisted snapshot current even before React commits a streamed update.
      const value =
        typeof updater === "function" ? updater(stateRef.current) : updater;
      stateRef.current = value;
      dirty.current = true;
      setState(value);
    },
    [],
  );
  const persist = useCallback(async function persistState(): Promise<void> {
    if (saving.current) {
      await saving.current;
      if (dirty.current) await persistState();
      return;
    }
    if (!dirty.current) return;
    dirty.current = false;
    const snapshot = stateRef.current;
    saving.current = (async () => {
      try {
        await bridge.save(snapshot);
        setSaveError("");
      } catch (e) {
        dirty.current = true;
        setSaveError((e as Error).message);
      } finally {
        saving.current = undefined;
      }
    })();
    await saving.current;
  }, []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    void persist();
  }, [persist]);
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const loaded = mergeState(await bridge.load());
      setState(loaded);
      stateRef.current = loaded;
      setReady(true);
      setLoadError("");
      setModelKey(
        loaded.settings.defaultModel ||
          providerEntries(loaded.settings.providers)[0]?.key ||
          "",
      );
      setEffort(
        loaded.conversations.find((c) => c.id === loaded.activeId)?.effort ||
          "auto",
      );
      setBaseTools(await bridge.tools());
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      loading.current = false;
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(
    () =>
      bridge.onToolsChanged?.(() => {
        void bridge
          .tools()
          .then(setBaseTools)
          .catch((error: Error) => notify(error.message));
      }),
    [notify],
  );
  useEffect(() => {
    if (!ready || busy) return;
    const timer = setTimeout(() => void persist(), 750);
    return () => clearTimeout(timer);
  }, [state, ready, busy, persist]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void persist(), 750);
    return () => clearTimeout(timer);
  }, [settings, ready, persist]);
  useEffect(() => {
    // Also apply restored/imported preferences to a running Agent.
    if (!ready || typeof bridge.setToolPermission !== "function") return;
    void bridge
      .setToolPermission(settings.toolPermission)
      .catch((error: Error) => notify(error.message));
  }, [ready, settings.toolPermission, notify]);
  useEffect(() => {
    // Checkpoint long responses without repeatedly encoding all history.
    const timer = setInterval(() => void persist(), 10000);
    return () => clearInterval(timer);
  }, [persist]);
  useEffect(() => {
    const save = () => void persist();
    window.addEventListener("pagehide", save);
    const detach = bridge.onLeave?.(save);
    return () => {
      window.removeEventListener("pagehide", save);
      detach?.();
    };
  }, [persist]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark =
        settings.theme === "dark" ||
        (settings.theme === "system" && query.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      setDarkTheme(dark);
      document.documentElement.dataset.motion = settings.reduceMotion
        ? "reduced"
        : "full";
      for (const [name, value] of Object.entries(
        skinVariables(activeSkin, dark),
      ))
        document.documentElement.style.setProperty(name, value);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [settings.theme, activeSkin, settings.reduceMotion]);
  const focusComposer = () =>
    setTimeout(() => window.dispatchEvent(new Event("lumen-focus")), 30);
  const newChat = useCallback(() => {
    setView("chat");
    update((s) => ({ ...s, activeId: undefined }));
    setDraft("");
    setAttachments([]);
    setEdit(undefined);
    setEffort("auto");
    setQuickAction(undefined);
    setModelKey(
      stateRef.current.settings.defaultModel ||
        providerEntries(stateRef.current.settings.providers)[0]?.key ||
        "",
    );
    setModelOpen(false);
    setToolsOpen(false);
    focusComposer();
  }, [update]);
  const selectConversation = useCallback(
    (c: Conversation) => {
      setView("chat");
      update((s) => ({ ...s, activeId: c.id }));
      setEffort(c.effort || "auto");
      if (c.modelKey) setModelKey(c.modelKey);
      setDraft("");
      setAttachments([]);
      setEdit(undefined);
      setQuickAction(undefined);
      setSearchOpen(false);
      setMenu("");
      setAtBottom(true);
    },
    [update],
  );
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        if (e.key === "Escape") {
          setImage(undefined);
          setModelOpen(false);
          setToolsOpen(false);
          setMenu("");
        }
        return;
      }
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.key.toLowerCase() === "o" && e.shiftKey) {
        e.preventDefault();
        newChat();
      } else if (e.key === ",") {
        e.preventDefault();
        openSettings();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [newChat, openSettings]);
  useEffect(() => {
    if (ready && view === "chat") {
      tail.current?.scrollIntoView({ behavior: "instant" });
      setAtBottom(true);
    }
  }, [ready, state.activeId, view]);
  useEffect(() => {
    if (atBottom && busy) tail.current?.scrollIntoView({ behavior: "instant" });
  }, [active?.messages, atBottom, busy]);
  useEffect(() => {
    const loaded = () => {
      if (atBottom && view === "chat")
        tail.current?.scrollIntoView({ behavior: "instant" });
    };
    window.addEventListener("lumen-image-loaded", loaded);
    return () => window.removeEventListener("lumen-image-loaded", loaded);
  }, [atBottom, view]);
  const addFiles = useCallback(
    async (files: File[]) => {
      const incoming: Attachment[] = [];
      let total = attachments.reduce((n, a) => n + a.size, 0);
      for (const file of files) {
        if (attachments.length + incoming.length >= 10) {
          notify("每条消息最多添加 10 个附件");
          break;
        }
        if (
          file.size > 12 * 1024 * 1024 ||
          total + file.size > 24 * 1024 * 1024
        ) {
          notify(`${file.name} 超过附件大小限制（单个 12 MB，合计 24 MB）`);
          continue;
        }
        try {
          if (file.type.startsWith("image/")) {
            const data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error("无法读取图片"));
              reader.readAsDataURL(file);
            });
            incoming.push({
              id: id(),
              name: file.name || "粘贴的图片.png",
              mime: file.type,
              type: "image",
              data,
              size: file.size,
            });
          } else {
            if (
              !/\.(txt|md|json|csv|ts|tsx|js|jsx|py|html|css|xml|ya?ml|log|sql|sh|toml|ini|c|cpp|h|rs|go|java)$/i.test(
                file.name,
              ) &&
              !file.type.startsWith("text/")
            ) {
              notify(`${file.name} 暂不支持。可添加文本、代码或图片。`);
              continue;
            }
            const data = await file.text();
            incoming.push({
              id: id(),
              name: file.name,
              mime: file.type || "text/plain",
              type: "text",
              data,
              size: file.size,
            });
          }
          total += file.size;
        } catch (e) {
          notify((e as Error).message);
        }
      }
      setAttachments((previous) => [...previous, ...incoming]);
      focusComposer();
    },
    [attachments, notify],
  );
  useEffect(() => bridge.onEnter?.(setPendingEntry), []);
  useEffect(() => {
    if (!ready || !pendingEntry) return;
    setPendingEntry(undefined);
    void entryHandler
      .current(pendingEntry)
      .catch((error: Error) => notify(error.message));
  }, [ready, pendingEntry, notify]);
  const tools = useMemo(
    () =>
      [
        ...baseTools.filter((t) => !t.custom),
        ...settings.customTools.map((t) => ({
          ...t,
          enabled: true,
          custom: true,
          approval: true,
        })),
      ].map((tool) => ({
        ...tool,
        enabled:
          tool.name === "list_tools" ||
          (!settings.disabledTools.includes(tool.name) &&
            (tool.name !== "web_search" || settings.search.enabled)),
        ...(tool.name === "generate_image"
          ? {
              enabled:
                !settings.disabledTools.includes(tool.name) &&
                settings.imageProviders.some(
                  (p) => p.enabled && p.models.length > 0,
                ),
            }
          : {}),
      })),
    [
      baseTools,
      settings.customTools,
      settings.disabledTools,
      settings.search.enabled,
      settings.imageProviders,
    ],
  );
  const toolCount = tools.filter((t) => t.enabled).length;
  const toggleTools = (names: string[], enabled: boolean) =>
    update((s) => ({
      ...s,
      settings: {
        ...s.settings,
        ...(names.includes("web_search")
          ? { search: { ...s.settings.search, enabled } }
          : {}),
        disabledTools: enabled
          ? s.settings.disabledTools.filter((n) => !names.includes(n))
          : [
              ...new Set([
                ...s.settings.disabledTools,
                ...names.filter((n) => n !== "list_tools"),
              ]),
            ],
      },
    }));
  const changeModel = (key: string) => {
    setModelKey(key);
    setModelOpen(false);
    update((s) => ({
      ...s,
      conversations: s.conversations.map((c) =>
        c.id === s.activeId ? { ...c, modelKey: key } : c,
      ),
    }));
    focusComposer();
  };
  const changeEffort = (value: string) => {
    setEffort(value);
    update((s) => ({
      ...s,
      conversations: s.conversations.map((c) =>
        c.id === s.activeId ? { ...c, effort: value } : c,
      ),
    }));
  };
  const changeToolPermission = async (mode: ToolPermissionMode) => {
    try {
      if (typeof bridge.setToolPermission !== "function")
        throw new Error("请完全退出插件后重新打开，以加载工具权限功能");
      await bridge.setToolPermission(mode);
      update((s) => ({
        ...s,
        settings: { ...s.settings, toolPermission: mode },
      }));
      void persist();
    } catch (error) {
      notify((error as Error).message);
    }
  };
  async function generate(
    conversation: Conversation,
    messages: Message[],
    target: ModelEntry | undefined = selected,
    requestEffort = effort,
  ) {
    if (!target) {
      notify("先连接供应商并选择一个启动模型");
      openSettings();
      return;
    }
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    streamMetricsRef.current = {
      startedAt: 0,
      outputTokens: 0,
    };
    setStreamMetrics({
      conversationId: conversation.id,
      outputTokens: 0,
      outputRate: 0,
      active: true,
    });
    setAtBottom(true);
    setToolsOpen(false);
    const reply: Message = {
      id: id(),
      role: "assistant",
      content: "",
      model: target.id,
      createdAt: Date.now(),
    };
    const cid = conversation.id;
    setStreamId(reply.id);
    setStreamConversation(cid);
    const nextConversation = {
      ...conversation,
      messages: [...messages, reply],
      modelKey: target.key,
      effort: requestEffort,
      updatedAt: Date.now(),
    };
    update((s) => ({
      ...s,
      activeId: cid,
      conversations: [
        nextConversation,
        ...s.conversations.filter((c) => c.id !== cid),
      ],
    }));
    let output = { ...reply };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      const metrics = streamMetricsRef.current;
      if (metrics.startedAt) {
        const elapsed = Math.max(100, Date.now() - metrics.startedAt) / 1000;
        setStreamMetrics({
          conversationId: cid,
          outputTokens: metrics.outputTokens,
          outputRate: metrics.outputTokens / elapsed,
          active: true,
        });
      }
      const snapshot = {
        ...output,
        tools: output.tools ? [...output.tools] : undefined,
      };
      update((s) => ({
        ...s,
        conversations: s.conversations.map((c) =>
          c.id === cid
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === reply.id ? snapshot : m,
                ),
                updatedAt: Date.now(),
              }
            : c,
        ),
      }));
    };
    try {
      await bridge.chat(
        {
          provider: target.provider,
          model: target.id,
          config: target.config,
          effort: requestEffort,
          messages,
          settings: agentSettings(stateRef.current.settings),
        },
        (event) => {
          switch (event.type) {
            case "text":
              output.content += event.text || "";
              if (event.text) {
                if (!streamMetricsRef.current.startedAt)
                  streamMetricsRef.current.startedAt = Date.now();
                if (streamMetricsRef.current.reportedOutput === undefined)
                  streamMetricsRef.current.outputTokens += estimateTextTokens(
                    event.text,
                  );
              }
              break;
            case "reasoning":
              output.reasoning = (output.reasoning || "") + (event.text || "");
              if (event.text) {
                if (!streamMetricsRef.current.startedAt)
                  streamMetricsRef.current.startedAt = Date.now();
                if (streamMetricsRef.current.reportedOutput === undefined)
                  streamMetricsRef.current.outputTokens += estimateTextTokens(
                    event.text,
                  );
              }
              break;
            case "tool":
              if (event.call)
                output.tools = [...(output.tools || []), event.call];
              break;
            case "tool-result":
              if (event.call)
                output.tools = output.tools?.map((t) =>
                  t.id === event.call!.id ? event.call! : t,
                );
              break;
            case "usage":
              output.usage = event.usage;
              if (typeof event.usage?.output === "number") {
                streamMetricsRef.current.reportedOutput = event.usage.output;
                streamMetricsRef.current.outputTokens = event.usage.output;
              }
              break;
            case "images":
              output.generatedImages = [
                ...(output.generatedImages || []),
                ...(event.images || []),
              ];
              break;
            case "approval":
              setApproval(event);
              break;
            case "approval-resolved":
              setApproval((current) =>
                current?.id === event.id ? undefined : current,
              );
              break;
            case "done":
              if (event.text === "stopped") output.interrupted = true;
              break;
          }
          if (!timer) timer = setTimeout(flush, 45);
        },
      );
    } catch (e) {
      output.error = (e as Error).message;
    } finally {
      flush();
      const metrics = streamMetricsRef.current;
      const elapsed = metrics.startedAt
        ? Math.max(100, Date.now() - metrics.startedAt) / 1000
        : 0;
      setStreamMetrics({
        conversationId: cid,
        outputTokens: metrics.outputTokens,
        outputRate: elapsed ? metrics.outputTokens / elapsed : 0,
        active: false,
      });
      setApproval(undefined);
      setBusy(false);
      setStreamId("");
      setStreamConversation("");
      sending.current = false;
      await persist();
      focusComposer();
    }
  }
  function send() {
    if ((!draft.trim() && !attachments.length) || sending.current) return;
    if (quickAction) {
      sendQuick(quickAction, draft, attachments);
      return;
    }
    if (!selected) {
      openSettings();
      notify("添加供应商后，勾选一个启动模型即可聊天");
      return;
    }
    if (
      attachments.some((a) => a.type === "image") &&
      selected.config.vision === false
    ) {
      notify("当前模型不支持图片，请切换视觉模型或调整模型配置");
      return;
    }
    const user: Message = {
      id: id(),
      role: "user",
      content: draft.trim(),
      attachments: [...attachments],
      createdAt: Date.now(),
    };
    const conversation = active || makeConversation();
    const messages =
      edit?.conversation === conversation.id
        ? conversation.messages.slice(0, edit.index)
        : conversation.messages;
    const titled = conversation.messages.length
      ? conversation
      : {
          ...conversation,
          title: (draft.trim() || attachments[0]?.name || "图片对话").slice(
            0,
            28,
          ),
        };
    setDraft("");
    setAttachments([]);
    setEdit(undefined);
    void generate(titled, [...messages, user]);
  }
  function imageAttachment(data: string): Attachment {
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(data))
      throw new Error("截图格式无效");
    const size = Math.ceil(data.slice(data.indexOf(",") + 1).length * 0.75);
    if (size > 12 * 1024 * 1024)
      throw new Error("截图超过 12 MB，请缩小截取范围");
    return {
      id: id(),
      name: "截图.png",
      type: "image",
      mime: data.slice(5, data.indexOf(";")),
      data,
      size,
    };
  }
  function sendQuick(
    action: QuickAction,
    text: string,
    images: Attachment[] = [],
  ) {
    const current = stateRef.current.settings;
    const available = providerEntries(current.providers);
    const target =
      available.find((entry) => entry.key === current.defaultModel) ||
      available[0];
    const stage = () => {
      setQuickAction(action);
      setDraft(text);
      setAttachments(images);
      focusComposer();
    };
    if (sending.current) {
      stage();
      notify("当前仍在生成，内容已放入输入框，请稍后发送");
      return;
    }
    if (!target) {
      stage();
      openSettings();
      notify("请先选择默认 Agent 的启动模型");
      return;
    }
    if (images.length && target.config.vision === false) {
      stage();
      notify("默认 Agent 不支持图片，请在设置中选择视觉模型作为默认 Agent");
      return;
    }
    const request = quickRequest(action, text, current.translationLanguage);
    const user: Message = {
      id: id(),
      role: "user",
      content: request.prompt,
      attachments: images,
      createdAt: Date.now(),
    };
    setDraft("");
    setAttachments([]);
    setQuickAction(undefined);
    setEdit(undefined);
    setEffort("auto");
    setModelKey(target.key);
    setSettingsOpen(false);
    setModelOpen(false);
    setToolsOpen(false);
    void generate(
      { ...makeConversation(), title: request.title },
      [user],
      target,
      "auto",
    );
  }
  async function captureImage() {
    if (!bridge.captureScreen) {
      notify("截图功能请在 uTools 中使用；也可以直接粘贴图片");
      return;
    }
    const data = await bridge.captureScreen();
    if (data) {
      const item = imageAttachment(data);
      if (
        attachments.length >= 10 ||
        attachments.reduce((total, item) => total + item.size, 0) + item.size >
          24 * 1024 * 1024
      ) {
        notify("附件已达数量或大小限制");
        return;
      }
      setAttachments((previous) => [...previous, item]);
    }
    focusComposer();
  }
  entryHandler.current = async (entry) => {
    if (
      ["translate", "screenshot-translate", "ask"].includes(entry.code || "")
    ) {
      const action = entry.code as QuickAction;
      if (action === "screenshot-translate") {
        const data =
          entry.type === "img" && typeof entry.payload === "string"
            ? entry.payload
            : await bridge.captureScreen?.();
        if (data) sendQuick(action, "", [imageAttachment(data)]);
        return;
      }
      const text =
        (entry.type === "over" || entry.type === "regex") &&
        typeof entry.payload === "string"
          ? entry.payload.trim()
          : "";
      if (text) sendQuick(action, text);
      else {
        newChat();
        setQuickAction(action);
        focusComposer();
      }
    } else if (entry.type === "over" && typeof entry.payload === "string") {
      setDraft(entry.payload);
      focusComposer();
    } else if (entry.type === "img" && typeof entry.payload === "string") {
      setAttachments((previous) => [
        ...previous.slice(0, 9),
        imageAttachment(entry.payload as string),
      ]);
      focusComposer();
    } else if (entry.type === "files")
      notify("请将文件拖入聊天或使用附件按钮添加。");
  };
  const generateRef = useRef(generate);
  generateRef.current = generate;
  const retry = useCallback(
    (messageId: string) => {
      if (sending.current) {
        notify("请先停止当前生成");
        return;
      }
      const current = stateRef.current;
      const conversation = current.conversations.find(
        (c) => c.id === current.activeId,
      );
      if (!conversation) return;
      const index = conversation.messages.findIndex((m) => m.id === messageId);
      if (index >= 0)
        void generateRef.current(
          conversation,
          conversation.messages.slice(0, index),
        );
    },
    [notify],
  );
  const editMessage = useCallback(
    (messageId: string) => {
      if (sending.current) {
        notify("请先停止当前生成");
        return;
      }
      const current = stateRef.current;
      const conversation = current.conversations.find(
        (c) => c.id === current.activeId,
      );
      const index =
        conversation?.messages.findIndex((m) => m.id === messageId) ?? -1;
      if (!conversation || index < 0) return;
      const message = conversation.messages[index];
      setDraft(message.content);
      setAttachments(message.attachments || []);
      setEdit({ conversation: conversation.id, index });
      focusComposer();
    },
    [notify],
  );
  const sorted = useMemo(
    () =>
      [...state.conversations].sort(
        (a, b) =>
          Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt,
      ),
    [state.conversations],
  );
  const searchResults = useMemo(() => {
    if (!searchOpen) return [];
    const query = searchQuery.toLowerCase();
    if (!query) return sorted;
    return sorted.filter((c) =>
      (c.title + " " + c.messages.map((m) => m.content).join(" "))
        .toLowerCase()
        .includes(query),
    );
  }, [sorted, searchOpen, searchQuery]);
  const exportConversation = useCallback(
    (c: Conversation) => {
      void bridge
        .exportFile(
          c.title.replace(/[<>:"/\\|?*]/g, "_") + ".md",
          `# ${c.title}\n\n` +
            c.messages
              .map(
                (m) =>
                  `## ${m.role === "user" ? "你" : "Lumen"}\n\n${m.content}${m.error ? "\n\n> " + m.error : ""}`,
              )
              .join("\n\n---\n\n"),
        )
        .catch((error: Error) => notify(error.message));
    },
    [notify],
  );
  const sidebarView = useMemo(
    () => (
      <aside className="sidebar">
        <div className="sidebar-brand">
          <button onClick={newChat} aria-label="Lumen · 新对话" title="新对话">
            <Logo small />
            <strong>
              Lumen<span>流明</span>
            </strong>
          </button>
          <IconButton label="收起侧栏" onClick={() => setSidebar(false)}>
            <PanelLeftClose size={17} />
          </IconButton>
        </div>
        <button
          className="new-chat"
          onClick={newChat}
          aria-label="开启新对话"
          title="开启新对话"
        >
          <SquarePen size={16} />
          <span>开启新对话</span>
          <kbd>Ctrl ⇧ O</kbd>
        </button>
        <button
          className="history-search"
          onClick={() => setSearchOpen(true)}
          aria-label="搜索对话"
          title="搜索对话"
        >
          <Search size={15} />
          <span>搜索对话</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button
          className={cx(
            "history-search",
            "studio-entry",
            view === "studio" && "active",
          )}
          onClick={() => {
            setStudioVisited(true);
            setView("studio");
          }}
          aria-label="打开生图工作室"
          aria-current={view === "studio" ? "page" : undefined}
        >
          <WandSparkles size={16} />
          <span>生图工作室</span>
          <span className="sidebar-beta">BETA</span>
        </button>
        <div className="history-heading">
          <span>你的对话</span>
          <span>
            {state.conversations.length
              ? String(state.conversations.length).padStart(2, "0")
              : ""}
          </span>
        </div>
        <div className="history-list">
          {!sorted.length && (
            <div className="history-empty">
              <MessageSquare size={21} />
              <p>
                每一次好奇，
                <br />
                都值得被记住。
              </p>
            </div>
          )}
          {sorted.map((c) => (
            <div
              className={cx(
                "history-item",
                view === "chat" && c.id === state.activeId && "active",
              )}
              key={c.id}
            >
              {rename === c.id ? (
                <input
                  autoFocus
                  defaultValue={c.title}
                  aria-label="对话名称"
                  onBlur={(e) => {
                    const title = e.target.value.trim();
                    if (title)
                      update((s) => ({
                        ...s,
                        conversations: s.conversations.map((x) =>
                          x.id === c.id ? { ...x, title } : x,
                        ),
                      }));
                    setRename("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRename("");
                  }}
                />
              ) : (
                <button
                  className="history-title"
                  onClick={() => selectConversation(c)}
                  onDoubleClick={() => setRename(c.id)}
                >
                  {c.pinned ? <Pin size={12} /> : <MessageSquare size={13} />}
                  <span>{c.title}</span>
                </button>
              )}
              <IconButton
                label={`对话操作 ${c.title}`}
                onClick={() => setMenu(menu === c.id ? "" : c.id)}
              >
                <Ellipsis size={15} />
              </IconButton>
              {menu === c.id && (
                <div className="popover history-menu">
                  <button
                    onClick={() => {
                      setRename(c.id);
                      setMenu("");
                    }}
                  >
                    <SquarePen size={13} />
                    重命名
                  </button>
                  <button
                    onClick={() => {
                      update((s) => ({
                        ...s,
                        conversations: s.conversations.map((x) =>
                          x.id === c.id ? { ...x, pinned: !x.pinned } : x,
                        ),
                      }));
                      setMenu("");
                    }}
                  >
                    <Pin size={13} />
                    {c.pinned ? "取消置顶" : "置顶对话"}
                  </button>
                  <button
                    onClick={() => {
                      exportConversation(c);
                      setMenu("");
                    }}
                  >
                    <ArrowDownToLine size={13} />
                    导出 Markdown
                  </button>
                  <button
                    className="danger-text"
                    onClick={() => {
                      setDeleteId(c.id);
                      setMenu("");
                    }}
                  >
                    <Trash2 size={13} />
                    删除对话
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="workspace-status">
            <span className="status-dot online" />
            <span>
              {settings.providers.length
                ? `${settings.providers.filter((p) => p.enabled).length} 个供应商已连接`
                : "连接你的 AI 世界"}
            </span>
            <ShieldCheck size={13} />
          </div>
          <button
            className="settings-entry"
            onClick={() => openSettings()}
            aria-label="打开设置"
            title="打开设置"
          >
            <span className="settings-avatar">
              <Settings2 size={17} />
            </span>
            <span>
              <strong>我的工作空间</strong>
              <small>设置 · 模型 · 皮肤</small>
            </span>
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>
    ),
    [
      newChat,
      sorted,
      state.activeId,
      rename,
      menu,
      update,
      selectConversation,
      exportConversation,
      settings.providers,
      openSettings,
      view,
    ],
  );
  if (loadError)
    return (
      <div className="loading-screen">
        <Logo />
        <h2>无法读取本地数据</h2>
        <p>{loadError}</p>
        <button className="button primary" onClick={() => void load()}>
          重试读取
        </button>
        <small>请保留用户目录下的 vault.key 与数据文件。</small>
      </div>
    );
  if (!ready)
    return (
      <div className="loading-screen">
        <Logo />
        <Loader2 size={20} className="spin" />
        <span>为你的想法，留一盏灯。</span>
      </div>
    );
  return (
    <div
      className={cx(
        "app",
        !sidebar && "sidebar-hidden",
        settings.compact && "compact",
      )}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          dragCount.current++;
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          dragCount.current--;
          if (dragCount.current <= 0) setDragging(false);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          dragCount.current = 0;
          setDragging(false);
          void addFiles([...e.dataTransfer.files]);
        }
      }}
    >
      {sidebarView}
      {studioVisited && (
        <Suspense
          fallback={
            view === "studio" ? (
              <div className="studio-loading">
                <Loader2 size={24} className="spin" />
              </div>
            ) : null
          }
        >
          <Studio
            hidden={view !== "studio"}
            settings={settings}
            sidebar={sidebar}
            onSidebar={() => setSidebar(true)}
            onChat={() => setView("chat")}
            onSettings={() => openSettings("images")}
            notify={notify}
          />
        </Suspense>
      )}
      <main
        style={view === "studio" ? { display: "none" } : undefined}
        className={cx("main", !active?.messages.length && "empty-chat")}
        data-layout={settings.chatLayout}
        data-bubbles={activeSkin.bubbleStyle || "soft"}
      >
        <div className="chat-backdrop" aria-hidden="true" />
        <header className="topbar">
          <div className="topbar-left">
            {!sidebar && (
              <IconButton label="展开侧栏" onClick={() => setSidebar(true)}>
                <PanelLeftOpen size={18} />
              </IconButton>
            )}
            <div className="popover-anchor">
              <button
                className="model-trigger"
                aria-label="选择聊天模型"
                aria-expanded={modelOpen}
                onClick={() => {
                  setModelOpen(!modelOpen);
                  setToolsOpen(false);
                }}
              >
                <span>{selected?.id || "选择你的模型"}</span>
                <ChevronDown size={14} />
              </button>
              {modelOpen && (
                <ModelPicker
                  entries={entries}
                  selected={selected?.key}
                  onSelect={changeModel}
                  onSettings={() => openSettings()}
                  onClose={() => setModelOpen(false)}
                />
              )}
            </div>
            <CapabilityTags config={selected?.config || {}} />
          </div>
          <div className="topbar-actions">
            <IconButton
              label="切换明暗模式"
              onClick={() =>
                update((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    theme: darkTheme ? "light" : "dark",
                  },
                }))
              }
            >
              {darkTheme ? <Moon size={17} /> : <Sun size={17} />}
            </IconButton>
            {active?.messages.length ? (
              <IconButton
                label="导出当前对话"
                onClick={() => exportConversation(active)}
              >
                <ArrowDownToLine size={16} />
              </IconButton>
            ) : null}
          </div>
        </header>
        {saveError && (
          <div className="save-error">
            本地保存失败：{saveError}
            <button onClick={() => void persist()}>重试</button>
          </div>
        )}
        <div
          className="chat-scroll"
          ref={scroll}
          onScroll={() => {
            const el = scroll.current;
            if (el)
              setAtBottom(
                el.scrollHeight - el.scrollTop - el.clientHeight < 100,
              );
          }}
        >
          {active?.messages.length ? (
            <div className="messages">
              {active.messages.map((m) => (
                <MessageView
                  key={m.id}
                  message={m}
                  streaming={busy && streamId === m.id}
                  onRetry={retry}
                  onEdit={editMessage}
                  onImage={setImage}
                  notify={notify}
                  userAvatar={settings.userAvatar}
                  agentAvatar={settings.agentAvatar}
                />
              ))}
              {approval && streamConversation === active.id && (
                <ApprovalCard
                  event={approval}
                  onApprove={(allow) => {
                    bridge.approve(approval.id!, allow);
                    setApproval(undefined);
                  }}
                />
              )}
              <div className="scroll-tail" ref={tail} />
            </div>
          ) : (
            <Welcome
              onPrompt={(text) => {
                setDraft(text);
                focusComposer();
              }}
              onAttach={() => {
                focusComposer();
                notify("直接粘贴图片，或点击输入框下方的「图片」按钮");
              }}
            />
          )}
        </div>
        {!atBottom && active?.messages.length ? (
          <button
            className="scroll-bottom"
            aria-label="滚动到最新消息"
            onClick={() => {
              setAtBottom(true);
              tail.current?.scrollIntoView({
                behavior: settings.reduceMotion ? "instant" : "smooth",
              });
            }}
          >
            <ArrowDown size={17} />
          </button>
        ) : null}
        {busy && streamConversation !== state.activeId && (
          <button
            className="other-chat-status"
            onClick={() => {
              const c = state.conversations.find(
                (c) => c.id === streamConversation,
              );
              if (c) selectConversation(c);
            }}
          >
            <Loader2 size={13} className="spin" />
            另一个对话正在生成，点击查看
            <ChevronRight size={13} />
          </button>
        )}
        <Composer
          quickLabel={
            quickAction
              ? quickAction === "ask"
                ? "AI 问答 · 粘贴即发送"
                : `翻译为 ${languageName(settings.translationLanguage)} · 粘贴即发送`
              : undefined
          }
          onCancelQuick={() => setQuickAction(undefined)}
          onPasteText={(text) => {
            if (!quickAction || !text.trim()) return false;
            sendQuick(quickAction, text, attachments);
            return true;
          }}
          onCapture={() =>
            void captureImage().catch((error: Error) => notify(error.message))
          }
          draft={draft}
          setDraft={(value) => {
            if (value.length > 12000) {
              const attachment: Attachment = {
                id: id(),
                name: "粘贴的长文本.txt",
                type: "text",
                mime: "text/plain",
                data: value,
                size: new Blob([value]).size,
              };
              setAttachments((a) => [...a, attachment]);
              setDraft("");
              notify("长文本已转为附件");
            } else setDraft(value);
          }}
          attachments={attachments}
          onRemove={(key) =>
            setAttachments((a) => a.filter((x) => x.id !== key))
          }
          onFiles={(files) => void addFiles(files)}
          onSend={send}
          onStop={() => {
            bridge.stop();
            notify("已停止生成");
          }}
          busy={busy}
          settings={settings}
          onToolPermissionChange={(mode) => void changeToolPermission(mode)}
          toolCount={toolCount}
          toolsOpen={toolsOpen}
          setToolsOpen={setToolsOpen}
          config={selected?.config || {}}
          effort={effort}
          setEffort={changeEffort}
          contextTokens={contextMetrics.tokens}
          contextLimit={contextMetrics.limit}
          contextEstimated={contextMetrics.estimated}
          outputRate={
            streamMetrics.conversationId === active?.id
              ? streamMetrics.outputRate
              : 0
          }
          outputTokens={
            streamMetrics.conversationId === active?.id
              ? streamMetrics.outputTokens
              : 0
          }
          editing={!!edit}
          onCancelEdit={() => {
            setEdit(undefined);
            setDraft("");
            setAttachments([]);
          }}
        >
          <ToolsPopover
            tools={tools}
            settings={settings}
            onToggle={toggleTools}
            onClose={() => setToolsOpen(false)}
            onSettings={() => openSettings("tools")}
          />
        </Composer>
      </main>
      {settingsOpen && (
        <Settings
          state={state}
          onChange={update}
          onClose={closeSettings}
          notify={notify}
          tools={tools}
          initialTab={settingsTab}
        />
      )}
      {searchOpen && (
        <Modal title="搜索对话" onClose={() => setSearchOpen(false)}>
          <div className="search-dialog">
            <div className="search-dialog-input">
              <Search size={19} />
              <input
                autoFocus
                aria-label="搜索历史对话"
                placeholder="搜索你的对话…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <IconButton label="关闭搜索" onClick={() => setSearchOpen(false)}>
                <X size={17} />
              </IconButton>
            </div>
            <div className="search-results">
              {searchResults.length ? (
                searchResults.map((c) => (
                  <button key={c.id} onClick={() => selectConversation(c)}>
                    <MessageSquare size={16} />
                    <span>
                      <strong>{c.title}</strong>
                      <small>
                        {c.messages
                          .find((m) =>
                            m.content
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase()),
                          )
                          ?.content.slice(0, 100) || "空对话"}
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))
              ) : (
                <div className="empty-inline">
                  没有找到对话，试试其他关键词。
                </div>
              )}
            </div>
            <div className="search-dialog-footer">
              <Command size={12} /> Ctrl K 搜索 · Ctrl Shift O 新对话
            </div>
          </div>
        </Modal>
      )}
      {image && (
        <div
          className="image-viewer"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={() => setImage(undefined)}
        >
          <IconButton label="关闭图片预览" onClick={() => setImage(undefined)}>
            <X size={22} />
          </IconButton>
          <img src={image.data} alt={image.name} />
          <span>{image.name}</span>
        </div>
      )}
      {deleteId && (
        <Modal title="删除对话" onClose={() => setDeleteId("")}>
          <div className="confirm-box">
            <Trash2 size={25} />
            <h3>删除这段对话？</h3>
            <p>删除后无法在界面中恢复。</p>
            <div className="row gap">
              <button className="button" onClick={() => setDeleteId("")}>
                取消
              </button>
              <button
                className="button danger"
                onClick={() => {
                  update((s) => ({
                    ...s,
                    conversations: s.conversations.filter(
                      (c) => c.id !== deleteId,
                    ),
                    activeId: s.activeId === deleteId ? undefined : s.activeId,
                  }));
                  setDeleteId("");
                }}
              >
                删除对话
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dragging && (
        <div className="drop-overlay">
          <div>
            <Plus size={30} />
            <h2>把灵感放进来</h2>
            <p>松开以添加图片、文本或代码文件</p>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
