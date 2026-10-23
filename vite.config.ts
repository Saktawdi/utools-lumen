import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { lumenBridge } from "./scripts/dev-plugin";
export default defineConfig({
  base: "./",
  plugins: [react(), lumenBridge()],
  build: { target: "chrome120" },
  server: { port: 5178, strictPort: true },
});
