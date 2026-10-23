# 工具扩展

## 本地工具

在 `runtime/extensions.cjs` 的导出函数中注册。构建后，工具在插件启动时加载，并自动出现在工具面板和 `list_tools` 中，无需修改聊天循环。

```js
module.exports = function registerExtensions(registerTool) {
  registerTool({
    name: "word_count",
    title: "统计字数",
    description: "统计给定文本的字符数和非空白字符数。",
    group: "文本工具",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    execute: ({ text }, { signal }) => {
      signal.throwIfAborted();
      return {
        characters: text.length,
        compact: text.replace(/\s/g, "").length,
      };
    },
  });
};
```

名称为 1–64 个字符，以字母开头，仅字母、数字、下划线和短横线。名称必须唯一，`execute` 必须是函数，输入 schema 的根类型必须为 `object`。

执行上下文包含 `settings`、`attachments`、`signal` 和 `approve(name,args)`。长操作应响应 `signal`，返回可 JSON 序列化的结果。设置 `approval: true` 后，每次执行前会显示名称与参数，等用户允许。写入文件、外部变更等工具应使用此选项。

运行期间可通过 preload 的 `window.lumen.registerTool(definition)` 注册，返回注销函数；前端会收到工具更新事件。此 API 只能用于可信的本地扩展代码。任意网页和模型输出都不能作为执行代码。

每次模型请求最多进行 8 轮工具循环，工具关闭时不再暴露给模型。`list_tools` 始终可用，但当前模型设置「工具调用：不支持」时不会发送工具定义。

## HTTP 工具

设置 → 工具扩展 → 注册 HTTP 工具：

```json
{
  "name": "lookup_issue",
  "title": "查询事项",
  "description": "根据事项编号查询详情。",
  "group": "我的服务",
  "endpoint": "https://your-service.example/lookup",
  "method": "POST",
  "inputSchema": {
    "type": "object",
    "properties": { "id": { "type": "string" } },
    "required": ["id"],
    "additionalProperties": false
  }
}
```

支持 `GET` 和 `POST`。GET 将参数编码进查询字符串；POST 发送 JSON。可配置 `headers`，默认不随无密钥备份导出。HTTP 工具每次调用都需要用户确认。

内置校验覆盖顶层 required、类型、enum 和 additionalProperties；复杂嵌套约束还应由工具服务自行验证。响应支持 JSON 或文本，最多读取 2 MB；工具结果进入对话前另有截断限制。

## 搜索

AnySearch 使用官方 `https://api.anysearch.com/mcp`，执行 MCP initialize → initialized → `tools/call search`。支持匿名模式及 Bearer 密钥。多个密钥可每行一个或使用 JSON 数组批量导入，去重后轮询；认证、限流和服务错误可尝试下一个密钥。

自定义 JSON 搜索发送 `{query,max_results}`，密钥可使用 Bearer、X-API-Key 或 `api_key` 字段。建议返回 `{results:[{title,url,content}]}`。SearXNG 请求使用 `q` 与 `format=json`。
