import type { Plugin } from "vite";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export function lumenBridge(): Plugin {
  const { Core } = require("../runtime/core.cjs");
  const core = new Core();
  return {
    name: "lumen-local-bridge",
    configureServer(server) {
      server.middlewares.use("/__lumen", async (req, res) => {
        if (
          req.method !== "POST" ||
          req.headers["x-lumen-client"] !== "local"
        ) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const host = req.headers.host;
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== host) {
          res.statusCode = 403;
          res.end();
          return;
        }
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 80 * 1024 * 1024) {
            res.statusCode = 413;
            res.end();
            return;
          }
        }
        try {
          const args = JSON.parse(raw || "{}");
          const method = req.url?.split("?")[0]?.replace(/^\//, "");
          let value;
          if (method === "chat") {
            res.setHeader("Content-Type", "application/x-ndjson");
            res.setHeader("Cache-Control", "no-store");
            res.flushHeaders();
            res.on("close", () => {
              if (!res.writableEnded) core.stop();
            });
            try {
              await core.chat(args, (event: unknown) =>
                res.write(JSON.stringify(event) + "\n"),
              );
            } catch (e) {
              res.write(
                JSON.stringify({ type: "error", text: (e as Error).message }) +
                  "\n",
              );
            }
            res.end();
            return;
          }
          switch (method) {
            case "load":
              value = core.load();
              break;
            case "save":
              value = await core.save(args);
              break;
            case "models":
              value = await core.models(args);
              break;
            case "catalog":
              value = await core.catalog(args.force);
              break;
            case "tools":
              value = core.tools(core.load()?.settings || {});
              break;
            case "searchTest":
              value = await core.searchTest(args.config, args.query);
              break;
            case "stop":
              core.stop();
              break;
            case "approve":
              core.approve(args.id, args.allow);
              break;
            case "setToolPermission":
              core.setToolPermission(args.mode);
              break;
            default:
              res.statusCode = 404;
              throw new Error("未知操作");
          }
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(value ?? null));
        } catch (e) {
          res.statusCode = res.statusCode === 404 ? 404 : 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
      });
    },
  };
}
