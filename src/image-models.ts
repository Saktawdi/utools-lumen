import catalog from "./image-profiles.json";
export function imageProfile(model: string, protocol?: string) {
  const id =
    protocol === "google-images"
      ? "google"
      : catalog.rules.find((rule) => new RegExp(rule.pattern, "i").test(model))
          ?.profile || "default";
  return catalog.profiles[id as keyof typeof catalog.profiles];
}
export function sizeLabel(size: string) {
  return (
    (
      {
        auto: "自动",
        "1024x1024": "1:1 · 1024²",
        "1536x1024": "3:2 · 横向",
        "1024x1536": "2:3 · 纵向",
        "1792x1024": "宽屏 · 1792×1024",
        "1024x1792": "竖屏 · 1024×1792",
      } as Record<string, string>
    )[size] || size
  );
}
