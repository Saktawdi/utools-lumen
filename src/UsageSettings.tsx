import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Download,
  Loader2,
  RefreshCw,
  Zap,
} from "lucide-react";
import { bridge } from "./bridge";
import type { UsageData } from "./types";
import {
  dailyUsage,
  dayKey,
  filterUsage,
  modelUsage,
  usageCsv,
  usageSummary,
} from "./usage-data";
import { cx } from "./ui";

const full = (n: number) => n.toLocaleString("zh-CN");
const compact = (n: number) =>
  n >= 1e6
    ? (n / 1e6).toFixed(n >= 1e8 ? 0 : 2) + "M"
    : n >= 1e3
      ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "K"
      : full(n);
const colors = [
  "var(--accent)",
  "#9092d0",
  "#ceaa72",
  "#80a5bd",
  "#bb859a",
  "var(--muted)",
];
export default function UsageSettings({
  notify,
}: {
  notify: (text: string) => void;
}) {
  const [data, setData] = useState<UsageData>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState("7");
  const [provider, setProvider] = useState("");
  const [kind, setKind] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [hoverDay, setHoverDay] = useState("");
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setData(await bridge.usage());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh]);
  const records = useMemo(() => data?.records || [], [data]);
  const filtered = useMemo(
    () => filterUsage(records, range, provider, kind),
    [records, range, provider, kind],
  );
  const total = useMemo(() => usageSummary(records), [records]);
  const current = useMemo(() => usageSummary(filtered), [filtered]);
  const models = useMemo(() => modelUsage(filtered), [filtered]);
  const daily = useMemo(
    () => dailyUsage(filtered, range === "all" ? 90 : Number(range)),
    [filtered, range],
  );
  const heatmap = useMemo(
    () => dailyUsage(filterUsage(records, "all", provider, kind), 364),
    [records, provider, kind],
  );
  const maxDay = Math.max(1, ...daily.map((d) => d.input + d.output));
  const heatMax = Math.max(1, ...heatmap.map((d) => d.requests));
  const peak = useMemo(
    () =>
      Math.max(0, ...dailyUsage(records, 365).map((d) => d.input + d.output)),
    [records],
  );
  const activeDays = useMemo(
    () => new Set(records.map((r) => dayKey(r.startedAt))).size,
    [records],
  );
  const providers = useMemo(
    () => [
      ...new Map(records.map((r) => [r.providerId, r.providerName])).entries(),
    ],
    [records],
  );
  const [heatFocus, setHeatFocus] = useState(363);
  const shownModels = models.slice(0, 5);
  const remainder = models.slice(5).reduce((n, m) => n + m.input + m.output, 0);
  const slices = [
    ...shownModels.map((m) => m.input + m.output),
    ...(remainder ? [remainder] : []),
  ];
  let offset = 0;
  const gradient = slices
    .map((n, i) => {
      const start = offset;
      offset += (n / Math.max(1, current.input + current.output)) * 100;
      return `${colors[i]} ${start}% ${offset}%`;
    })
    .join(",");
  const days = daily.filter((d) => d.requests);
  const hover = daily.find((d) => d.day === hoverDay);
  const recent = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, showAll ? 100 : 8),
    [filtered, showAll],
  );
  if (!data && busy)
    return (
      <div className="settings-empty">
        <Loader2 size={24} className="spin" />
        <p>正在读取用量记录…</p>
      </div>
    );
  return (
    <div className="usage-settings">
      {error && (
        <div className="studio-task-error" role="alert">
          <p>{error}</p>
          <button className="button small" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      )}
      <div className="usage-lifetime">
        <div>
          <strong title={full(total.input + total.output)}>
            {compact(total.input + total.output)}
          </strong>
          <span>累计 Token</span>
        </div>
        <div>
          <strong>{compact(peak)}</strong>
          <span>近一年单日峰值</span>
        </div>
        <div>
          <strong>
            {full(activeDays)}
            <small> 天</small>
          </strong>
          <span>活跃天数</span>
        </div>
        <div>
          <strong>{full(total.requests)}</strong>
          <span>累计请求</span>
        </div>
      </div>
      <section className="usage-heatmap-section" aria-label="最近一年活跃度">
        <div className="row between">
          <h4>
            创作足迹 <span className="muted">最近一年</span>
          </h4>
          <span className="heatmap-legend">
            少
            {[0, 1, 2, 3].map((n) => (
              <i key={n} data-level={n} />
            ))}
            多
          </span>
        </div>
        <div className="usage-heatmap">
          {heatmap.map((d, i) => (
            <span
              tabIndex={heatFocus === i ? 0 : -1}
              onKeyDown={(e) => {
                const delta = {
                  ArrowLeft: -7,
                  ArrowRight: 7,
                  ArrowUp: -1,
                  ArrowDown: 1,
                }[e.key as string];
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? heatmap.length - 1
                      : delta
                        ? Math.max(0, Math.min(heatmap.length - 1, i + delta))
                        : i;
                if (next !== i) {
                  e.preventDefault();
                  setHeatFocus(next);
                  (
                    e.currentTarget.parentElement?.children[next] as HTMLElement
                  )?.focus();
                }
              }}
              key={d.day}
              data-level={
                d.requests === 0
                  ? 0
                  : Math.min(3, Math.ceil((d.requests / heatMax) * 3))
              }
              title={`${d.day} · ${full(d.requests)} 次请求 · ${full(d.input + d.output)} Token`}
              aria-label={`${d.day}：${d.requests} 次请求，${full(d.input + d.output)} Token`}
            />
          ))}
        </div>
      </section>
      <div className="usage-filters">
        <div className="segmented" role="group" aria-label="统计时间范围">
          {[
            ["1", "今天"],
            ["7", "7 天"],
            ["30", "30 天"],
            ["90", "90 天"],
            ["all", "全部"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={cx(range === value && "active")}
              aria-pressed={range === value}
              onClick={() => {
                setRange(value);
                setShowAll(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="row gap">
          <select
            aria-label="统计供应商"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="">全部供应商</option>
            {providers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="统计请求类型"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">全部类型</option>
            <option value="chat">聊天</option>
            <option value="image">生图</option>
          </select>
        </div>
      </div>
      <div className="usage-metrics">
        <div>
          <span>
            <ArrowDownLeft size={14} />
            输入 Token
          </span>
          <strong title={full(current.input)}>{compact(current.input)}</strong>
          <small>缓存读取 {compact(current.cachedInput)}</small>
        </div>
        <div>
          <span>
            <ArrowUpRight size={14} />
            输出 Token
          </span>
          <strong title={full(current.output)}>
            {compact(current.output)}
          </strong>
          <small>推理 {compact(current.reasoning)}</small>
        </div>
        <div>
          <span>
            <Zap size={14} />
            缓存命中
          </span>
          <strong>
            {current.input
              ? ((current.cachedInput / current.input) * 100).toFixed(1)
              : "0"}
            <em>%</em>
          </strong>
          <small>写入 {compact(current.cacheWrite)}</small>
        </div>
        <div>
          <span>
            <Activity size={14} />
            请求次数
          </span>
          <strong>{compact(current.requests)}</strong>
          <small>
            {current.unreported
              ? `${full(current.unreported)} 次未报告用量`
              : `${full(current.images)} 张生成图片`}
          </small>
        </div>
      </div>
      {!filtered.length && (
        <div className="usage-empty">
          <BarChart3 size={28} />
          <div>
            <h3>
              {records.length ? "这个范围还没有用量" : "从下一次对话开始记录"}
            </h3>
            <p>
              {records.length
                ? "切换日期、供应商或请求类型查看。"
                : "聊天、工具多轮调用和生图会在这里汇总。"}
            </p>
          </div>
        </div>
      )}
      <section className="usage-chart-card">
        <div className="row between wrap gap">
          <h3>
            每日用量{" "}
            <small className="muted">
              {range === "all" ? "最近 90 天" : "按本机日期"}
            </small>
          </h3>
          <div className="chart-legend">
            <span>
              <i />
              输入
            </span>
            <span>
              <i />
              输出
            </span>
          </div>
        </div>
        <div className="usage-chart-readout">
          {hover ? (
            <>
              <strong>{hover.day.slice(5)}</strong>
              <span>
                输入 {full(hover.input)} · 输出 {full(hover.output)} ·{" "}
                {full(hover.requests)} 次请求
              </span>
            </>
          ) : (
            <>
              <strong>{compact(current.input + current.output)} Token</strong>
              <span>{days.length} 个活跃日</span>
            </>
          )}
        </div>
        <div
          className="usage-bar-chart"
          role="group"
          aria-label="每日 Token 趋势"
          onMouseLeave={() => setHoverDay("")}
        >
          {daily.map((d) => (
            <button
              key={d.day}
              className={cx(
                "usage-bar-column",
                d.day === hoverDay && "hovered",
              )}
              aria-label={`${d.day} 输入 ${d.input}，输出 ${d.output}，${d.requests} 次请求`}
              title={`${d.day}\n输入 ${full(d.input)}\n输出 ${full(d.output)}\n${full(d.requests)} 次请求`}
              onMouseEnter={() => setHoverDay(d.day)}
              onFocus={() => setHoverDay(d.day)}
              onBlur={() => setHoverDay("")}
            >
              <span
                className="usage-bar-stack"
                style={{
                  height: `${((d.input + d.output) / maxDay) * 100}%`,
                  minHeight: d.requests ? 3 : 1,
                }}
              >
                <i style={{ flex: d.output || 0 }} />
                <i style={{ flex: d.input || 0 }} />
              </span>
            </button>
          ))}
        </div>
        <div className="usage-chart-axis">
          <span>{daily[0]?.day.slice(5)}</span>
          <span>{daily[Math.floor(daily.length / 2)]?.day.slice(5)}</span>
          <span>{daily.at(-1)?.day.slice(5)}</span>
        </div>
      </section>
      <section className="usage-chart-card">
        <div className="row between">
          <h3>模型分布</h3>
          <small className="muted">{models.length} 个模型</small>
        </div>
        <div className="usage-model-distribution">
          <div
            className="usage-donut"
            role="img"
            aria-label={`总计 ${full(current.input + current.output)} Token`}
            style={{
              background:
                current.input + current.output
                  ? `conic-gradient(${gradient})`
                  : "var(--surface-3)",
            }}
          >
            <div>
              <strong>{compact(current.input + current.output)}</strong>
              <small>Token</small>
            </div>
          </div>
          <div className="usage-model-list">
            {shownModels.length ? (
              shownModels.map((m, i) => (
                <div key={m.key}>
                  <i style={{ background: colors[i] }} />
                  <span>
                    <strong title={m.model}>{m.model}</strong>
                    <small>
                      {m.providerName} · {m.requests} 次请求
                    </small>
                  </span>
                  <strong>
                    {compact(m.input + m.output)}
                    <small>
                      {current.input + current.output
                        ? (
                            ((m.input + m.output) /
                              (current.input + current.output)) *
                            100
                          ).toFixed(1)
                        : "0"}
                      %
                    </small>
                  </strong>
                </div>
              ))
            ) : (
              <p className="muted">还没有模型用量</p>
            )}
            {remainder > 0 && (
              <div>
                <i style={{ background: colors[5] }} />
                <span>其他模型</span>
                <strong>{compact(remainder)}</strong>
              </div>
            )}
          </div>
        </div>
      </section>
      <section className="usage-chart-card">
        <div className="row between">
          <h3>最近请求</h3>
          <small className="muted">
            {filtered.some((r) => r.legacy)
              ? "含历史回复汇总记录"
              : "每轮 API 请求独立记录"}
          </small>
        </div>
        <div className="usage-table-wrap">
          <table className="usage-table">
            <thead>
              <tr>
                <th>时间 / 模型</th>
                <th>输入</th>
                <th>输出</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong title={r.model}>{r.model}</strong>
                    <small>
                      {new Date(r.startedAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {r.providerName}
                      {r.kind === "image" ? " · 生图" : ""}
                    </small>
                  </td>
                  <td
                    title={
                      r.cachedInput
                        ? `缓存读取 ${full(r.cachedInput)}`
                        : undefined
                    }
                  >
                    {r.reported ? full(r.input) : "—"}
                  </td>
                  <td
                    title={
                      r.reasoning ? `含推理 ${full(r.reasoning)}` : undefined
                    }
                  >
                    {r.reported ? full(r.output) : "—"}
                  </td>
                  <td>
                    <span className={cx("usage-status", r.status)}>
                      {
                        { success: "完成", error: "失败", cancelled: "已停止" }[
                          r.status
                        ]
                      }
                    </span>
                    {!r.reported && <small>未报告用量</small>}
                  </td>
                </tr>
              ))}
              {!recent.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    暂无请求记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 8 && !showAll && (
          <button
            className="text-button usage-show-more"
            onClick={() => setShowAll(true)}
          >
            展开最近 {Math.min(100, filtered.length)} 条
          </button>
        )}
      </section>
      <div className="usage-footer">
        <p>
          缓存读写计入输入，推理计入输出。未返回 usage 的请求不估算；Token
          不等同于供应商账单。
        </p>
        <div className="row gap">
          <button
            className="button small"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={13} className={busy ? "spin" : undefined} />
            刷新
          </button>
          <button
            className="button small"
            disabled={!filtered.length}
            onClick={() =>
              void bridge
                .exportFile(
                  `lumen-usage-${dayKey(Date.now())}.csv`,
                  usageCsv(filtered),
                )
                .catch((e) => notify(e.message))
            }
          >
            <Download size={13} />
            导出 CSV
          </button>
        </div>
      </div>
    </div>
  );
}
