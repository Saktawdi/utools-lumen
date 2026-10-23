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
    /(?:[-_]?\d{4}[-_]?\d{2}[-_]?\d{2}|[-_](?:latest|preview|stable|nightly))$/i,
    "",
  );
const canonical = new Set([
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "alibaba",
  "moonshotai",
  "xai",
  "mistral",
  "cohere",
  "zai",
  "minimax",
]);
const steps = [
  (v: string) => norm(v),
  (v: string) => norm(strip(v)),
  (v: string) => norm(bare(v)),
  (v: string) => norm(strip(bare(v))),
];
const cache = new WeakMap<object, Map<string, Entry[]>[]>();
export function matchModel(
  id: string,
  raw: Record<string, unknown>,
): ModelConfig | null {
  let indexes = cache.get(raw);
  if (!indexes) {
    indexes = steps.map(() => new Map<string, Entry[]>());
    for (const entry of Object.values(raw)) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof (entry as Entry).id !== "string"
      )
        continue;
      const model = entry as Entry;
      steps.forEach((key, i) => {
        const value = key(model.id);
        const rows = indexes![i].get(value) || [];
        rows.push(model);
        indexes![i].set(value, rows);
      });
    }
    cache.set(raw, indexes);
  }
  let selected: Entry | undefined;
  for (let i = 0; i < steps.length; i++) {
    const matches = indexes[i].get(steps[i](id)) || [];
    if (!matches.length) continue;
    const explicit = id.includes("/")
      ? matches.find((m) => norm(m.providerId || "") === norm(id.split("/")[0]))
      : undefined;
    const originals = matches.filter((m) =>
      canonical.has(norm(m.providerId || "")),
    );
    if (explicit || originals.length === 1) {
      selected = explicit || originals[0];
      break;
    }
    const signatures = new Set(
      matches.map((m) =>
        JSON.stringify([
          m.reasoning,
          m.tool_call,
          m.modalities?.input,
          m.limit?.context,
          m.limit?.output,
          m.reasoning_options,
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
    vision: (m.modalities?.input || []).includes("image"),
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
