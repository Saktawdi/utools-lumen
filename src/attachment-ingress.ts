import type { Attachment } from "./types";

export type AttachmentSource = "paste" | "host" | "capture" | "file";
type ImageReceipt = {
  fingerprint: string;
  sources: Set<AttachmentSource>;
  attachmentId: string;
  at: number;
};
type ReceiveResult = { added: number; overLimit: boolean };

// The host and clipboard may encode the same pixels as different PNG byte streams.
export async function imageFingerprint(data: string): Promise<string> {
  if (typeof Image === "undefined" || typeof document === "undefined")
    return "data:" + data;
  const image = new Image();
  let canvas: HTMLCanvasElement | undefined;
  try {
    image.src = data;
    await image.decode();
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (!width || !height || width * height > 16_777_216) return "data:" + data;
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "data:" + data;
    context.drawImage(image, 0, 0);
    if (!globalThis.crypto?.subtle)
      return "png:" + canvas.toDataURL("image/png");
    const pixels = context.getImageData(0, 0, width, height).data;
    const hash = await crypto.subtle.digest("SHA-256", pixels);
    const hex = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `pixels:${width}x${height}:${hex}`;
  } catch {
    // Failure to decode must never discard a user's attachment or guess equivalence.
    return "data:" + data;
  } finally {
    image.src = "";
    if (canvas) canvas.width = canvas.height = 0;
  }
}

export class AttachmentIngress {
  private pending: Promise<unknown> = Promise.resolve();
  private recent: ImageReceipt[] = [];
  private revision = 0;
  constructor(
    private fingerprint = imageFingerprint,
    private windowMs = 1500,
  ) {}
  token() {
    return this.revision;
  }
  reset() {
    this.revision++;
    this.recent = [];
  }

  receive(
    incoming: Attachment[],
    source: AttachmentSource,
    at: number,
    current: () => Attachment[],
    commit: (attachments: Attachment[]) => void,
    token = this.revision,
  ): Promise<ReceiveResult> {
    const job = this.pending.then(async (): Promise<ReceiveResult> => {
      if (token !== this.revision) return { added: 0, overLimit: false };
      const keys = new Map<string, string>();
      if (source !== "file") {
        for (const item of incoming)
          if (item.type === "image" && !keys.has(item.data))
            keys.set(item.data, await this.fingerprint(item.data));
      }
      if (token !== this.revision) return { added: 0, overLimit: false };
      const next = [...current()];
      const ids = new Set(next.map((item) => item.id));
      this.recent = this.recent.filter((receipt) =>
        ids.has(receipt.attachmentId),
      );
      const batch = new Set<string>();
      let added = 0,
        overLimit = false;
      let total = next.reduce((sum, item) => sum + item.size, 0);
      for (const item of incoming) {
        const key = item.type === "image" ? keys.get(item.data) : undefined;
        if (key) {
          if (batch.has(key)) continue;
          batch.add(key);
          // Each receipt can consume one echo from each OTHER source. Repeated
          // pastes from the same source are distinct actions, even milliseconds apart.
          const echo = this.recent.find(
            (receipt) =>
              receipt.fingerprint === key &&
              !receipt.sources.has(source) &&
              Math.abs(receipt.at - at) <= this.windowMs,
          );
          if (echo) {
            echo.sources.add(source);
            continue;
          }
        }
        if (
          next.length >= 10 ||
          item.size > 12 * 1024 * 1024 ||
          total + item.size > 24 * 1024 * 1024
        ) {
          overLimit = true;
          continue;
        }
        next.push(item);
        added++;
        total += item.size;
        if (key)
          this.recent.push({
            fingerprint: key,
            sources: new Set([source]),
            attachmentId: item.id,
            at,
          });
      }
      // At most ten live attachments; bound stale pairing metadata as well.
      this.recent = this.recent.slice(-40);
      if (added) commit(next);
      return { added, overLimit };
    });
    // Serialize both hashing and committing, so simultaneous ingress cannot both
    // decide the draft is empty. A failed input must not block the next one.
    this.pending = job.catch(() => {});
    return job;
  }
}
