import type { Plugin } from "vite";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
export function lumenBridge(): Plugin {
  const { Core } = require("../runtime/core.cjs");
  const core = new Core();
  return {
    name: "lumen-local-bridge",
    configureServer(server) {
      const exports = new Map<
        string,
        { name: string; content: string; at: number }
      >();
      server.middlewares.use("/__lumen", async (req, res) => {
        const downloadId = req.url?.match(
          /^\/download\/([a-zA-Z0-9-]{1,80})$/,
        )?.[1];
        const exportId = req.url?.match(
          /^\/export\/([a-zA-Z0-9-]{1,80})$/,
        )?.[1];
        if (req.method === "GET" && (downloadId || exportId)) {
          const origin = req.headers.origin;
          if (
            (req.headers["sec-fetch-site"] &&
              !["same-origin", "none"].includes(
                String(req.headers["sec-fetch-site"]),
              )) ||
            (origin && new URL(origin).host !== req.headers.host)
          ) {
            res.statusCode = 403;
            res.end();
            return;
          }
          try {
            if (exportId) {
              const file = exports.get(exportId);
              if (!file || Date.now() - file.at > 120000)
                throw new Error("导出已过期");
              res.setHeader("Content-Type", "application/octet-stream");
              res.setHeader(
                "Content-Disposition",
                `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
              );
              res.setHeader("Cache-Control", "no-store");
              res.setHeader("X-Content-Type-Options", "nosniff");
              res.end(file.content);
              return;
            }
            const data = core.imageAsset(downloadId);
            const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(
              data,
            );
            if (!match) throw new Error("图片数据无效");
            const ext =
              match[1] === "image/jpeg" ? "jpg" : match[1].split("/")[1];
            res.setHeader("Content-Type", match[1]);
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="lumen-${downloadId}.${ext}"`,
            );
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.end(Buffer.from(match[2], "base64"));
          } catch {
            res.statusCode = 404;
            res.end("Image not found");
          }
          return;
        }
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
            case "exportFile": {
              if (
                typeof args.name !== "string" ||
                typeof args.content !== "string"
              )
                throw new Error("导出内容无效");
              for (const [id, file] of exports)
                if (Date.now() - file.at > 120000) exports.delete(id);
              if (exports.size >= 3)
                exports.delete(exports.keys().next().value!);
              const id = randomUUID();
              exports.set(id, {
                name: args.name
                  .replace(/[\\/\r\n\x00-\x1f]/g, "_")
                  .slice(0, 120),
                content: args.content,
                at: Date.now(),
              });
              value = { id };
              break;
            }
            case "imageGenerate":
              value = await core.imageGenerate(args);
              break;
            case "imageJobs":
              value = core.imageJobs();
              break;
            case "imageAsset":
              value = core.imageAsset(args.id, args.thumbnail);
              break;
            case "imageThumbnail":
              value = await core.imageThumbnail(args.id, args.data);
              break;
            case "imageCancel":
              value = core.imageCancel(args.id);
              break;
            case "imageRemove":
              value = await core.imageRemove(args.id);
              break;
            case "imageFavorite":
              value = await core.imageFavorite(args.id, args.favorite);
              break;
            case "usage":
              value = await core.usage();
              break;
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
