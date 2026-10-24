import type { Skin } from "./types";

// Background filters live on a separate layer; text and controls stay sharp.
export function skinVariables(
  skin: Skin,
  dark: boolean,
): Record<string, string> {
  return {
    "--accent": dark ? skin.darkAccent : skin.accent,
    "--skin-bg": (dark ? skin.darkBackground : skin.background) || "var(--bg)",
    "--wallpaper": skin.backgroundImage
      ? `url("${skin.backgroundImage}")`
      : "none",
    "--wallpaper-blur": `${skin.backgroundBlur ?? 12}px`,
    "--wallpaper-opacity": String(skin.backgroundOpacity ?? 0.18),
    "--wallpaper-position": skin.backgroundPosition || "center",
    "--bubble-radius": `${skin.bubbleRadius ?? 18}px`,
    "--bubble-opacity": `${Math.round((skin.bubbleOpacity ?? 0.96) * 100)}%`,
    "--user-bubble":
      (dark ? skin.darkUserBubble : skin.userBubble) ||
      "color-mix(in srgb, var(--accent) 11%, var(--surface))",
    "--agent-bubble":
      (dark ? skin.darkAgentBubble : skin.agentBubble) || "var(--surface)",
  };
}

/** Import a still, resized copy so large photos never enter the chat render path. */
export async function readAppearanceImage(
  file: File,
  kind: "avatar" | "background",
): Promise<string> {
  if (!/^image\/(png|jpeg|webp|avif|gif)$/i.test(file.type))
    throw new Error("请选择 PNG、JPG、WebP、AVIF 或 GIF 图片");
  if (file.size > 20 * 1024 * 1024) throw new Error("图片需小于 20 MB");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error("这张图片无法读取，请换一张图片");
    });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境无法处理图片");
    const edge = kind === "avatar" ? 256 : 1920;
    if (kind === "avatar") {
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      canvas.width = canvas.height = Math.min(edge, side);
      context.drawImage(
        image,
        (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    } else {
      const scale = Math.min(
        1,
        edge / Math.max(image.naturalWidth, image.naturalHeight),
      );
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
    const data = canvas.toDataURL("image/webp", 0.84);
    if (data.length > (kind === "avatar" ? 384 * 1024 : 4 * 1024 * 1024))
      throw new Error("处理后的图片仍然过大，请选择较小的图片");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
