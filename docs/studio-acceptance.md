# 生图工作室与 Token 统计 · 本地验收

仅供本机开发，不公开。完成日期：2026-10-24。

## 明天如何启动

双击工程根目录的 `start-local.cmd`，自动启动浏览器版本：

- 工程：`D:\project\ai-generate\lumen-utools`
- 地址：`http://127.0.0.1:5178`
- 不需要先打开 uTools。
- 使用既有本机用户配置，数据目录 `%APPDATA%\uTools\lumen`。
- 若提示5178端口占用，可直接打开上述地址；修改运行时代码后应先结束旧服务再重新启动。

本地模拟演示可双击 `.local\start-studio-demo.cmd`，使用独立的5188端口和隔离数据。它会启动5191模拟服务，**不产生真实模型图片**。关闭服务窗口后模拟API也会结束；再次打开时保留既有演示数据。

## 可验收内容

1. 侧栏「生图工作室」：生图/画廊两个页面；选择模型、描述、参考图、尺寸/比例、质量/背景/数量；参数随模型限制。
2. 偏好设置 →「生图供应商」：OpenAI Images兼容和Gemini原生，独立连接；批量密钥轮询、复制聊天连接、拉取模型、手动添加、默认模型、高级headers。
3. 生成结果：预览、复制、下载、继续改图；生成中可切换聊天或停止；失败可查看原因、重用参数。
4. 画廊：自动收录、搜索、收藏、重用参数、分页加载、删除确认。图片与参考图加密保存在本机。
5. 聊天：`generate_image` 已注册；支持 `list_tools` 发现；默认「每次询问」审批，Auto自动允许；图片显示在聊天并进入画廊。
6. **偏好设置 →「Token 统计」**：累计用量、最近一年热力图、日期/供应商/类型筛选、每日趋势、模型分布、最近请求、CSV。计数基于供应商返回值，不猜测未返回的Token。
7. 明暗模式、现有皮肤、减少动效与窄窗口排版。

## 构建与验证

- TypeScript与50项自动回归全部通过。
- 实际打包preload在Worker正常与禁用两种环境均通过。
- 浏览器完成OpenAI/Gemini本地模拟、参考图编辑、Agent审批、失败/停止、收藏与下载等操作。
- CSV与图片均实际下载到Downloads，复制图片有成功回执。
- RSI：首轮79，本轮87/100；维度与依据见 `studio-rsi.md`。
- 构建目录：`dist\plugin.json`，ZIP：`release\lumen-0.1.0-local.zip`。
- ZIP为218193字节、16个文件；确认含CommonJS标记和独立storage worker，不含docs、演示数据、加密文件或真实凭据。审计摘要：`.local/verification/package.json`。
- ZIP是uTools开发者工具源码导入包。此次未重新发布GitHub release，也未生成新的市场发行版或伪造`.upxs`。
- 已导入本地dist工程的uTools需要完全退出插件再打开，重新加载preload。

## 真实供应商限制

现有供应商各尝试一次小规模请求：

- Images：HTTP403，`Image generation is not enabled for this group`。
- Gemini：HTTP400，`API key group platform is not gemini`。

两组现有密钥均未成功返回真实图片。需在生图供应商中填写已开通对应生图接口权限的连接，再进行真实效果验收。不会将模拟图称为真实模型验证成功。

## 数据与公开边界

`docs/`、`.local/`、截图、真实配置与密钥不公开。本地原仓库历史没有推送到公开仓库。JSON配置与聊天备份不包含独立画廊文件和统计账本；完整备份应复制数据目录及其`vault.key`。真实配置没有被模拟连接覆盖。

本轮截图保存在 `.local\verification`。图像缩略图采用384px WebP，原图按需读取，限制并发与缓存容量。性能小样本见 `performance.json`。
