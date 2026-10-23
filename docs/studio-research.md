# 生图工作室与 Token 统计设计调研

日期：2026-10-24。本文仅供本地开发，禁止公开或随发行包发布。

## 已查阅的一手来源

- ZCode 官方开源仓库 https://github.com/zai-org/ZCode ，具体阅读 `packages/ui/src/settings/UsageStatsSection.tsx`、`settings/usage-stats/AppUsagePanel.tsx`、`hooks/useUsageStats.ts`。其应用用量在设置页，采用累计摘要、活跃热力图、日期范围、每日趋势和模型占比，图表按需加载以避免拖慢首页。本项目借鉴信息层级，不复制代码或引入其图表依赖。编码套餐账户监控不适用于 BYOK，故仅统计本插件实际请求。
- OpenAI 官方 Image generation 指南 https://developers.openai.com/api/docs/guides/image-generation ，读取页面及 Markdown。区分文生图 generations 和基于参考图的 edits；独立工作室使用 Images API。通过已有 Agent 注册工具统一使用工作室服务。尺寸、质量、透明背景在协议支持时发送，避免无关参数。
- Google Gemini 图像指南 https://ai.google.dev/gemini-api/docs/image-generation ，确认文字/参考图输入、inlineData 图片输出及 imageConfig 比例设置。
- Black Forest Labs 官方生成流程 https://docs.bfl.ai/quick_start/generating_images ，观察提示词、输出比例、异步任务与完成结果的流程。此次支持 OpenAI Images 兼容接口与 Gemini 原生接口；不虚构对 BFL 原生异步协议的支持。

网络搜索工具当时不可用，以上通过官方 GitHub API 和直连官方文档取得，缓存置于 ignored `.local/research/`。

## 交互决策

1. 侧栏搜索对话下新增「生图工作室」，聊天与工作室切换保留状态。
2. 工作室提供「生图」「画廊」两页。生图左侧是紧凑的模型、描述、参考图、尺寸/比例、质量、数量和背景；右侧是生成状态与结果，空态给可编辑的提示词示例。窄窗口改为上下排列。
3. 显示真实运行/取消/失败/成功状态，不伪造生成进度。失败可重用参数，停止保留已经生成的结果。结果支持放大、下载、复制、作为参考继续改图。
4. 画廊自动收录工作室与 Agent 的所有记录；支持关键词搜索、收藏过滤、按需加载、详情、参数重用和删除确认。图片与聊天状态分开持久化，避免每次聊天保存编码全部图片。
5. 设置独立「生图供应商」，不混入聊天启动模型。支持两协议、多密钥轮询、模型拉取和手动模型列表、默认生图模型。
6. `generate_image` 遵守现有 Auto/每次询问模式。工具返回图片 ID 和少量元数据，图片单独显示，不向后续 LLM 上下文塞入输出 base64。
7. Token 统计在偏好设置导航内，采用累计摘要、日期范围、请求种类/供应商筛选、活跃热力图、日趋势、模型排行和最近请求。记录每轮上游请求，包含缓存、推理和生图 API 用量。没有 usage 字段的请求显示未报告；不猜测为真实账单，不填虚构价格。历史聊天用量一次性迁移并注明按回复合并的旧记录。
8. 复用所有皮肤变量与减少动态效果开关；不引入远程字体或大型图表依赖。

## 验证约束

使用 `LUMEN_DATA_DIR=.local/studio-test-data` 隔离现有真实设置。通过本地 HTTP 服务验证协议、任务取消、图像持久化、Agent 审批及多轮 Token 用量；浏览器验证真实用户路径。仅在明确具备可用图像服务时进行实际供应商测试，未经验证不声称线上模型生成成功。
