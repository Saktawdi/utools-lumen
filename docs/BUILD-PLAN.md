# Lumen · 流明

轻量、本地优先的 uTools Agent 聊天插件。先完成全部功能和运行验证，再开始 RSI 自评迭代。

## 交付要求

- 独立项目和本地 Git 版本库；可安装的插件包与可继续开发的源码。
- ChatGPT 式会话、历史搜索、Markdown、复制/重试、流式输出、停止、错误恢复。
- 图片粘贴/拖放/选择、文件附件、长文本转附件、uTools 图片与文本入口。
- 精细的响应式界面、动效、键盘交互、浅色/深色/跟随系统，以及可导入的皮肤模块。
- 自定义 BYOK 供应商，多密钥、拉取模型、复选/批选与联想输入组成启动列表。
- 任意启动模型切换；models.dev 能力匹配、上下文/视觉/工具/推理参数、手动覆盖。
- 可配置推理强度；OpenAI Chat/Responses、Anthropic、Google 协议适配。
- 工具注册、分组开关、list_tools、真实工具调用与结果展示。
- AnySearch 网页搜索；批量密钥导入、轮询、失败切换与搜索测试。
- 迁移 ChatGPT.好友 的所有自定义供应商，保持本地，校验数量和密钥一致性。
- 在本机 uTools 安装并实际运行；全部功能完成后执行 RSI 自评和迭代，整体 >80 才交付验收。

## 实现原则

- React + TypeScript + Vite，CSS 动效，无运行时 UI 框架。
- uTools preload 处理网络与本地持久化；无需常驻后台服务。
- 密钥和聊天保存在本机用户目录；不进入源码、Git、日志或默认导出。
- 目录元数据仅作增强，失败可手动输入。严格匹配，用户覆盖优先。
- 不自动运行任意代码；写入和扩展 HTTP 工具显示执行确认。
- 扩展开发使用 `registerTool` 和皮肤 token，不更改聊天核心。

## 参考

- https://github.com/Saktawdi/opentreelearn （本机参考提交 8900b8c17f4f193e673b5fca8edbdfe106627c08；参考交互与数据匹配思路，独立实现）
- https://models.dev/api.json
- https://developers.openai.com/api/docs/guides/reasoning
- 用户提供的工具分组与输入框截图。
