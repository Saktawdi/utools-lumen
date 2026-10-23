import type { Bridge, StreamEvent } from "./types";
export { mergeState } from "./state-data";
const api = async <T>(method: string, args: unknown = {}): Promise<T> => {
  const response = await fetch("/__lumen/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Lumen-Client": "local" },
    body: JSON.stringify(args),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "本地桥接服务不可用");
  return result;
};
let controller: AbortController | undefined;
const preview: Bridge = {
  load: () => api("load"),
  save: (state) => api("save", state),
  models: (provider) => api("models", provider),
  catalog: (force) => api("catalog", { force }),
  tools: () => api("tools"),
  searchTest: (config, query) => api("searchTest", { config, query }),
  async chat(args, onEvent) {
    const pending = new AbortController();
    controller = pending;
    const response = await fetch("/__lumen/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lumen-Client": "local",
      },
      body: JSON.stringify(args),
      signal: pending.signal,
    });
    if (!response.ok) throw new Error("本地聊天服务不可用");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let n;
        while ((n = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, n);
          buffer = buffer.slice(n + 1);
          if (line) {
            const event: StreamEvent = JSON.parse(line);
            if (event.type === "error") throw new Error(event.text);
            onEvent(event);
          }
        }
      }
    } catch (e) {
      if (!pending.signal.aborted) throw e;
      onEvent({ type: "done", text: "stopped" });
    } finally {
      controller = undefined;
    }
  },
  stop: () => {
    void api("stop");
    controller?.abort();
  },
  approve: (id, allow) => {
    void api("approve", { id, allow });
  },
  setToolPermission: (mode) => api("setToolPermission", { mode }),
  exportFile: async (name, content) => {
    const blob = new Blob([content], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  openExternal: (url) => {
    if (/^https?:\/\//i.test(url))
      window.open(url, "_blank", "noopener,noreferrer");
  },
  onEnter: (fn) => {
    // Development-only entry simulation uses the same queue as uTools onPluginEnter.
    const query = new URLSearchParams(location.search);
    const code = query.get("command");
    let live = true;
    if (
      import.meta.env.DEV &&
      ["translate", "ask", "screenshot-translate"].includes(code || "")
    ) {
      queueMicrotask(() => {
        if (live)
          fn({
            code: code!,
            type: query.has("text") ? "over" : "text",
            payload: query.get("text") || "",
          });
      });
    }
    return () => {
      live = false;
    };
  },
};
const nativeUnavailable: Bridge = {
  ...preview,
  load: async () => {
    throw new Error(
      window.lumenBootError ||
        "uTools 本地桥接未加载。请完全退出插件后重新打开，并在调试面板查看 preload 报错。",
    );
  },
};
export const bridge =
  window.lumen || (location.protocol === "file:" ? nativeUnavailable : preview);
