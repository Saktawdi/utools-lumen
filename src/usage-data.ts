import type { UsageRecord } from "./types";
export const dayKey = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
export function usageSummary(records: UsageRecord[]) {
  return records.reduce(
    (sum, r) => ({
      input: sum.input + r.input,
      output: sum.output + r.output,
      cachedInput: sum.cachedInput + (r.cachedInput || 0),
      cacheWrite: sum.cacheWrite + (r.cacheWrite || 0),
      reasoning: sum.reasoning + (r.reasoning || 0),
      images: sum.images + (r.images || 0),
      requests: sum.requests + 1,
      unreported: sum.unreported + (r.reported ? 0 : 1),
    }),
    {
      input: 0,
      output: 0,
      cachedInput: 0,
      cacheWrite: 0,
      reasoning: 0,
      images: 0,
      requests: 0,
      unreported: 0,
    },
  );
}
export function filterUsage(
  records: UsageRecord[],
  range: string,
  provider: string,
  kind: string,
  now = Date.now(),
) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range !== "all") start.setDate(start.getDate() - (Number(range) - 1));
  return records.filter(
    (r) =>
      (range === "all" || r.startedAt >= start.getTime()) &&
      (!provider || r.providerId === provider) &&
      (!kind || r.kind === kind),
  );
}
export function dailyUsage(
  records: UsageRecord[],
  days: number,
  now = Date.now(),
) {
  const map = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const key = dayKey(record.startedAt);
    const group = map.get(key) || [];
    group.push(record);
    map.set(key, group);
  }
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const key = dayKey(date.getTime());
    result.push({ day: key, ...usageSummary(map.get(key) || []) });
  }
  return result;
}
export function modelUsage(records: UsageRecord[]) {
  const groups = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const key = record.providerId + "::" + record.model;
    const rows = groups.get(key) || [];
    rows.push(record);
    groups.set(key, rows);
  }
  return [...groups.entries()]
    .map(([key, rows]) => ({
      key,
      model: rows[0].model,
      providerName: rows[0].providerName,
      ...usageSummary(rows),
    }))
    .sort(
      (a, b) =>
        b.input + b.output - a.input - a.output || b.requests - a.requests,
    );
}
export function usageCsv(records: UsageRecord[]) {
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    return (
      '"' +
      (/^[=+\-@\t\r]/.test(text) ? "'" : "") +
      text.replace(/"/g, '""') +
      '"'
    );
  };
  return (
    "\uFEFF" +
    [
      [
        "时间",
        "供应商",
        "模型",
        "类型",
        "状态",
        "已报告用量",
        "输入",
        "输出",
        "缓存读取",
        "缓存写入",
        "推理",
        "图片",
      ],
      ...records.map((r) => [
        new Date(r.startedAt).toISOString(),
        r.providerName,
        r.model,
        r.kind,
        r.status,
        r.reported,
        r.input,
        r.output,
        r.cachedInput || 0,
        r.cacheWrite || 0,
        r.reasoning || 0,
        r.images || 0,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
