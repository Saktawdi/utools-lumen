const { Core } = require("./core.cjs");
const fs = require("node:fs");
const core = new Core();
require("./extensions.cjs")((tool) => core.registerTool(tool));
let enterListener;
let pendingEnter;
let leaveListener;
window.lumen = {
  load: async () => core.load(),
  save: (state) => core.save(state),
  models: (p) => core.models(p),
  catalog: (force) => core.catalog(force),
  tools: async () => core.tools(core.load()?.settings || {}),
  chat: (args, onEvent) => core.chat(args, onEvent),
  stop: () => core.stop(),
  approve: (id, allow) => core.approve(id, allow),
  setToolPermission: async (mode) => core.setToolPermission(mode),
  searchTest: (config, query) => core.searchTest(config, query),
  registerTool: (tool) => {
    const remove = core.registerTool(tool);
    window.dispatchEvent(new Event("lumen-tools-changed"));
    return () => {
      remove();
      window.dispatchEvent(new Event("lumen-tools-changed"));
    };
  },
  onToolsChanged: (fn) => {
    window.addEventListener("lumen-tools-changed", fn);
    return () => window.removeEventListener("lumen-tools-changed", fn);
  },
  exportFile: async (name, content) => {
    const file = utools.showSaveDialog({
      title: "导出 Lumen 数据",
      defaultPath: name,
      filters: [{ name: "JSON / Markdown", extensions: ["json", "md"] }],
    });
    if (file) await fs.promises.writeFile(file, content, "utf8");
  },
  openExternal: (url) => {
    if (/^https?:\/\//i.test(url)) utools.shellOpenExternal(url);
  },
  captureScreen: async () => {
    utools.hideMainWindow();
    try {
      const image = await utools.screenCapture();
      if (image) utools.copyImage(image);
      return image || null;
    } finally {
      utools.showMainWindow();
    }
  },
  onEnter: (fn) => {
    enterListener = fn;
    if (pendingEnter) {
      fn(pendingEnter);
      pendingEnter = null;
    }
    return () => {
      enterListener = null;
    };
  },
  onLeave: (fn) => {
    leaveListener = fn;
    return () => {
      leaveListener = null;
    };
  },
};
utools.onPluginEnter((entry) => {
  try {
    if (utools.setExpandHeight) utools.setExpandHeight(720);
    else utools.setExpendHeight(720);
  } catch {}
  pendingEnter = { code: entry.code, type: entry.type, payload: entry.payload };
  if (enterListener) {
    enterListener(pendingEnter);
    pendingEnter = null;
  }
});
utools.onPluginOut(() => {
  core.stop();
  leaveListener?.();
});
