import { useEffect, useRef, useState } from "react";
import { AlertCircle, Copy, Download, Image, Loader2, X } from "lucide-react";
import { bridge } from "./bridge";
import type { ImageAsset } from "./types";
import { IconButton, Modal } from "./ui";

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();
let cachedChars = 0;
let loading = 0;
const waiting: (() => void)[] = [];
const maxChars = 24 * 1024 * 1024;
function cacheImage(key: string, data: string) {
  while (
    cache.size &&
    (cache.size >= 16 || cachedChars + data.length > maxChars)
  ) {
    const first = cache.keys().next().value!;
    cachedChars -= cache.get(first)!.length;
    cache.delete(first);
  }
  if (data.length <= maxChars) {
    cache.set(key, data);
    cachedChars += data.length;
  }
}
async function thumbnailData(id: string, data: string) {
  const bitmap = await createImageBitmap(await (await fetch(data)).blob());
  try {
    if (
      Math.max(bitmap.width, bitmap.height) <= 384 &&
      (data.startsWith("data:image/webp") || data.length < 12000)
    )
      return data;
    const scale = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumbnail = canvas.toDataURL("image/webp", 0.78);
    const result =
      thumbnail.length < data.length || scale < 1 ? thumbnail : data;
    if (result.length < 340000)
      await bridge.imageThumbnail(id, result).catch(() => {});
    return result;
  } finally {
    bitmap.close();
  }
}
export async function loadImageAsset(
  id: string,
  thumbnail = false,
): Promise<string> {
  const key = id + (thumbnail ? ":thumb" : "");
  if (cache.has(key)) return cache.get(key)!;
  if (inFlight.has(key)) return inFlight.get(key)!;
  const pending = (async () => {
    if (loading >= 3)
      await new Promise<void>((resolve) => waiting.push(resolve));
    else loading++;
    try {
      let data = await bridge.imageAsset(id, thumbnail);
      if (thumbnail) data = await thumbnailData(id, data);
      cacheImage(key, data);
      return data;
    } finally {
      const next = waiting.shift();
      if (next) next();
      else loading--;
    }
  })();
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    inFlight.delete(key);
  }
}
export function forgetImageAsset(id: string) {
  for (const key of [id, id + ":thumb"])
    if (cache.has(key)) {
      cachedChars -= cache.get(key)!.length;
      cache.delete(key);
    }
}
export function AssetImage({
  asset,
  alt,
  eager = false,
}: {
  asset: ImageAsset;
  alt: string;
  eager?: boolean;
}) {
  const [src, setSrc] = useState(
    cache.get(asset.id + (eager ? "" : ":thumb")) || "",
  );
  const [error, setError] = useState(false);
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void loadImageAsset(asset.id, !eager)
        .then((data) => {
          if (alive) setSrc(data);
        })
        .catch(() => {
          if (alive) setError(true);
        });
    if (eager || !host.current || !window.IntersectionObserver) load();
    else {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            observer.disconnect();
            load();
          }
        },
        { rootMargin: "160px" },
      );
      observer.observe(host.current);
      return () => {
        alive = false;
        observer.disconnect();
      };
    }
    return () => {
      alive = false;
    };
  }, [asset.id, eager]);
  return (
    <span className="asset-image" ref={host}>
      {src ? (
        <img
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => window.dispatchEvent(new Event("lumen-image-loaded"))}
          onError={() => {
            setSrc("");
            setError(true);
          }}
        />
      ) : error ? (
        <span className="asset-unavailable">
          <AlertCircle size={18} />
          图片不可用
        </span>
      ) : (
        <Loader2 size={20} className="spin" />
      )}
    </span>
  );
}
export function ImageViewer({
  assets,
  index = 0,
  prompt = "生成的图片",
  onClose,
  notify,
  onReference,
}: {
  assets: ImageAsset[];
  index?: number;
  prompt?: string;
  onClose: () => void;
  notify: (text: string) => void;
  onReference?: (asset: ImageAsset) => void;
}) {
  const [current, setCurrent] = useState(index);
  const asset = assets[current] || assets[0];
  const run = async (fn: () => Promise<void>, success?: string) => {
    try {
      await fn();
      if (success) notify(success);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  if (!asset) return null;
  return (
    <Modal wide title="图片预览" onClose={onClose}>
      <div className="image-viewer">
        <div className="image-viewer-bar">
          <span>
            <Image size={15} />
            图片预览
            {assets.length > 1 && ` · ${current + 1} / ${assets.length}`}
          </span>
          <IconButton label="关闭图片预览" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="image-viewer-canvas">
          <AssetImage key={asset.id} asset={asset} alt={prompt} eager />
        </div>
        <div className="image-viewer-footer">
          <p>{prompt}</p>
          <div className="row gap wrap">
            {assets.length > 1 && (
              <>
                <button
                  className="button small"
                  disabled={current === 0}
                  onClick={() => setCurrent((i) => i - 1)}
                >
                  上一张
                </button>
                <button
                  className="button small"
                  disabled={current === assets.length - 1}
                  onClick={() => setCurrent((i) => i + 1)}
                >
                  下一张
                </button>
              </>
            )}
            {onReference && (
              <button
                className="button small"
                onClick={() => {
                  onReference(asset);
                  onClose();
                }}
              >
                作为参考图
              </button>
            )}
            <button
              className="button small"
              onClick={() =>
                void run(() => bridge.copyImage(asset.id), "图片已复制")
              }
            >
              <Copy size={14} />
              复制
            </button>
            <button
              className="button primary small"
              onClick={() => void run(() => bridge.saveImage(asset.id))}
            >
              <Download size={14} />
              下载
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
export function GeneratedImages({
  assets,
  notify,
}: {
  assets: ImageAsset[];
  notify: (text: string) => void;
}) {
  const [view, setView] = useState<number>();
  return (
    <>
      <div className="generated-images">
        {assets.map((asset, i) => (
          <button
            key={asset.id}
            aria-label={`查看生成图片 ${i + 1}`}
            onClick={() => setView(i)}
          >
            <AssetImage asset={asset} alt={`生成图片 ${i + 1}`} />
          </button>
        ))}
      </div>
      {view !== undefined && (
        <ImageViewer
          assets={assets}
          index={view}
          onClose={() => setView(undefined)}
          notify={notify}
        />
      )}
    </>
  );
}
