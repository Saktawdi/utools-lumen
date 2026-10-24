import type { Message } from "./types";

const CJK_OR_WIDE =
  /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7ff\uf900-\ufaff\ufe10-\ufe6f\uff00-\uffef]/;

/**
 * A deliberately conservative UI estimate for providers that do not report
 * prompt usage. It is only used until the first provider usage sample arrives.
 */
export function estimateTextTokens(value: string) {
  let wide = 0;
  let narrow = 0;
  for (const character of value) {
    if (CJK_OR_WIDE.test(character)) wide++;
    else narrow++;
  }
  return wide + Math.ceil(narrow / 4);
}

export function estimateContextTokens(messages: Message[]) {
  return messages.reduce((total, message) => {
    const text = estimateTextTokens(
      `${message.content}\n${message.reasoning || ""}`,
    );
    const attachments = (message.attachments || []).reduce(
      (sum, attachment) =>
        sum +
        (attachment.type === "image"
          ? 1024
          : estimateTextTokens(attachment.data)),
      0,
    );
    return total + text + attachments;
  }, 0);
}

export function formatTokenCount(value: number) {
  const tokens = Math.max(0, Math.round(value));
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`;
  if (tokens >= 1_000)
    return `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}K`;
  return tokens.toLocaleString("zh-CN");
}
