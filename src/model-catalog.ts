import type { ModelConfig } from "./types";
type Entry = {
  id: string;
  providerId?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  modalities?: { input: string[] };
  limit?: { context: number; output: number };
  reasoning_options?: { type: string; values?: string[] }[];
};
const norm = (id: string) => id.toLowerCase().replace(/[^a-z0-9]/g, "");
const bare = (id: string) => id.slice(id.lastIndexOf("/") + 1);
const strip = (id: string) =>
  id.replace(
    /(?:[-_]?\d{4}[-_]?\d{2}[-_]?\d{2}|[-_.]v\d+(?:\.\d+)*|[-_](?:latest|preview|stable|nightly))$/i,
    "",
  );
export function matchModel(
  id: string,
  raw: Record<string, unknown>,
): ModelConfig | null {
  const entries = Object.values(raw).filter(
    (x): x is Entry =>
      !!x && typeof x === "object" && typeof (x as Entry).id === "string",
  );
  let selected: Entry | undefined;
  for (const key of [
    (v: string) => norm(v),
    (v: string) => norm(strip(v)),
    (v: string) => norm(bare(v)),
    (v: string) => norm(strip(bare(v))),
  ]) {
    const matches = entries.filter((m) => key(m.id) === key(id));
    if (!matches.length) continue;
    const signatures = new Set(
      matches.map((m) =>
        JSON.stringify([
          m.reasoning,
          m.tool_call,
          m.modalities?.input,
          m.limit?.context,
        ]),
      ),
    );
    if (signatures.size > 1) {
      selected = matches.find(
        (m) => norm(m.providerId || "") === norm(id.split("/")[0]),
      );
      if (!selected) continue;
    } else selected = matches[0];
    break;
  }
  if (!selected) return null;
  const m = selected;
  const levels = new Set<string>();
  let reasoningMode: ModelConfig["reasoningMode"] = "effort";
  for (const option of m.reasoning_options || []) {
    if (option.type === "effort")
      for (const v of option.values || []) levels.add(v);
    if (option.type === "toggle") {
      levels.add("none");
      reasoningMode = "toggle";
    }
    if (option.type === "budget") reasoningMode = "budget";
  }
  return {
    vision: m.modalities?.input?.includes("image"),
    reasoning: m.reasoning === true,
    tools: m.tool_call !== false,
    context: m.limit?.context,
    output: m.limit?.output,
    levels: [...levels],
    reasoningMode,
    matchedId: m.id,
    source: "models.dev",
  };
}
