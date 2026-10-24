import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { lumenBridge } from "./scripts/dev-plugin";
import manifest from "./public/plugin.json";
import packageInfo from "./package.json";
export default defineConfig({
  base: "./",
  plugins: [react(), lumenBridge()],
  define: {
    __LUMEN_APP_INFO__: JSON.stringify({
      name: manifest.pluginName,
      version: manifest.version,
      repositoryUrl: packageInfo.repository.url.replace(/\.git$/, ""),
    }),
  },
  build: { target: "chrome120" },
  server: { port: 5178, strictPort: true },
});
