const crypto = require("node:crypto");
function endpoint(base, suffix) {
  let root = base.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(root))
    throw new Error("供应商地址需要以 http:// 或 https:// 开头");
  if (/\/(chat\/completions|responses|messages)$/.test(root))
    root = root.replace(/\/(chat\/completions|responses|messages)$/, "");
  return root + "/" + suffix;
}
const imageParts = (m) =>
  (m.images || []).map((image) => ({
    type: "image_url",
    image_url: { url: image },
  }));
function chatMessages(messages) {
  return messages.map((m) =>
    m.role === "tool"
      ? { role: "tool", tool_call_id: m.tool_call_id, content: m.content }
      : {
          role: m.role,
          content: m.images?.length
            ? [
                { type: "text", text: m.content || "请查看图片" },
                ...imageParts(m),
              ]
            : m.content || null,
          ...(m.tool_calls?.length
            ? {
                tool_calls: m.tool_calls.map((c) => ({
                  id: c.id,
                  type: "function",
                  function: { name: c.name, arguments: c.arguments },
                })),
              }
            : {}),
        },
  );
}
function buildRequest(provider, model, messages, tools, effort, config = {}) {
  const headers = { ...provider.headers };
  let body, url;
  const max = config.maxTokens || Math.min(config.output || 8192, 8192);
  if (provider.protocol === "responses") {
    const input = messages.flatMap((m) =>
      m.role === "tool"
        ? [
            {
              type: "function_call_output",
              call_id: m.tool_call_id,
              output: m.content,
            },
          ]
        : m.nativeResponses?.length
          ? m.nativeResponses
          : [
              ...(m.content || m.images?.length
                ? [
                    {
                      role: m.role,
                      content: m.images?.length
                        ? [
                            {
                              type: "input_text",
                              text: m.content || "请查看图片",
                            },
                            ...m.images.map((image_url) => ({
                              type: "input_image",
                              image_url,
                            })),
                          ]
                        : m.content,
                    },
                  ]
                : []),
              ...(m.tool_calls || []).map((c) => ({
                type: "function_call",
                call_id: c.id,
                name: c.name,
                arguments: c.arguments,
              })),
            ],
    );
    body = {
      model,
      input,
      stream: true,
      include: ["reasoning.encrypted_content"],
      max_output_tokens: max,
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: "function",
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
            })),
          }
        : {}),
      ...(effort && effort !== "auto" ? { reasoning: { effort } } : {}),
    };
    url = endpoint(provider.baseURL, "responses");
  } else if (provider.protocol === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    const native = [];
    for (const m of messages.filter((m) => m.role !== "system")) {
      const content =
        m.role === "tool"
          ? [
              {
                type: "tool_result",
                tool_use_id: m.tool_call_id,
                content: m.content,
              },
            ]
          : m.nativeAnthropic?.length
            ? m.nativeAnthropic
            : [
                ...(m.content ? [{ type: "text", text: m.content }] : []),
                ...(m.images || []).map((img) => {
                  const match = img.match(/^data:([^;]+);base64,(.*)$/s);
                  if (!match) throw new Error("图片数据无效");
                  return {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: match[1],
                      data: match[2],
                    },
                  };
                }),
                ...(m.tool_calls || []).map((c) => ({
                  type: "tool_use",
                  id: c.id,
                  name: c.name,
                  input: JSON.parse(c.arguments || "{}"),
                })),
              ];
      const role = m.role === "assistant" ? "assistant" : "user";
      if (native.at(-1)?.role === role) native.at(-1).content.push(...content);
      else native.push({ role, content });
    }
    body = {
      model,
      system: messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n"),
      messages: native,
      stream: true,
      max_tokens: max,
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema,
            })),
          }
        : {}),
    };
    if (effort && effort !== "auto" && effort !== "none") {
      if (max <= 1024)
        throw new Error("启用 Anthropic 思考时，最大输出 Token 需要大于 1024");
      const adaptive = /claude-(?:opus|sonnet)-(?:4[.-][6-9]|[5-9])/i.test(
        model,
      );
      if (config.reasoningMode === "budget" || !adaptive)
        body.thinking = {
          type: "enabled",
          budget_tokens: Math.min(
            max - 1,
            Math.max(
              1024,
              { low: 1024, medium: 2048, high: 4096, xhigh: 6144, max: 7168 }[
                effort
              ] || 2048,
            ),
          ),
        };
      else {
        body.thinking = { type: "adaptive" };
        body.output_config = { effort };
      }
    } else if (effort === "none") body.thinking = { type: "disabled" };
    url = endpoint(provider.baseURL, "messages");
  } else if (provider.protocol === "google") {
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts:
          m.role === "tool"
            ? [
                {
                  functionResponse: {
                    name: m.tool_name,
                    id: m.tool_call_id,
                    response: { result: m.content },
                  },
                },
              ]
            : m.nativeGoogle?.length
              ? m.nativeGoogle
              : [
                  ...(m.content ? [{ text: m.content }] : []),
                  ...(m.images || []).map((img) => {
                    const [, mimeType, data] =
                      img.match(/^data:([^;]+);base64,(.*)$/s) || [];
                    return { inlineData: { mimeType, data } };
                  }),
                  ...(m.tool_calls || []).map((c) => ({
                    functionCall: {
                      name: c.name,
                      id: c.id,
                      args: JSON.parse(c.arguments || "{}"),
                    },
                  })),
                ],
      }));
    const budget =
      config.reasoningMode === "budget" || /^gemini-2/i.test(model);
    body = {
      contents,
      systemInstruction: {
        parts: [
          {
            text: messages
              .filter((m) => m.role === "system")
              .map((m) => m.content)
              .join("\n"),
          },
        ],
      },
      generationConfig: {
        maxOutputTokens: max,
        ...(effort && effort !== "auto"
          ? {
              thinkingConfig:
                effort === "none"
                  ? { thinkingBudget: 0 }
                  : budget
                    ? {
                        thinkingBudget:
                          {
                            minimal: 512,
                            low: 1024,
                            medium: 4096,
                            high: 8192,
                            xhigh: 16384,
                            max: 24576,
                          }[effort] || 4096,
                        includeThoughts: true,
                      }
                    : { thinkingLevel: effort, includeThoughts: true },
            }
          : {}),
      },
      ...(tools.length
        ? {
            tools: [
              {
                functionDeclarations: tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.inputSchema,
                })),
              },
            ],
          }
        : {}),
    };
    const root = provider.baseURL.replace(/\/+$/, "");
    url =
      root +
      `/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  } else {
    const tokenField = /^(?:o[1345](?:-|$)|gpt-(?:[5-9]|1\d)|chatgpt-)/i.test(
      model,
    )
      ? "max_completion_tokens"
      : "max_tokens";
    body = {
      model,
      messages: chatMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
      [tokenField]: max,
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              },
            })),
          }
        : {}),
    };
    if (effort && effort !== "auto") {
      if (config.reasoningMode === "toggle")
        body.enable_thinking = effort !== "none";
      else body.reasoning_effort = effort;
    }
    if (
      typeof config.temperature === "number" &&
      !(effort && effort !== "auto" && effort !== "none")
    )
      body.temperature = config.temperature;
    url = endpoint(provider.baseURL, "chat/completions");
  }
  return { url, body, headers };
}
function authHeaders(provider, key) {
  return provider.protocol === "anthropic"
    ? { "x-api-key": key }
    : provider.protocol === "google"
      ? { "x-goog-api-key": key }
      : key
        ? { Authorization: "Bearer " + key }
        : {};
}
function createCollector(protocol, onEvent) {
  let text = "",
    reasoning = "",
    usage;
  const calls = new Map();
  const blockMap = new Map();
  const responseItems = new Map();
  const googleParts = [];
  const add = (type, value) => {
    if (!value) return;
    if (type === "text") text += value;
    else reasoning += value;
    onEvent({ type, text: value });
  };
  const tool = (index, patch) => {
    const old = calls.get(index) || { id: "", name: "", arguments: "" };
    calls.set(index, {
      id: patch.id || old.id,
      name: patch.name || old.name,
      arguments: old.arguments + (patch.arguments || ""),
    });
  };
  return {
    push(data, event) {
      if (data.error)
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : data.error.message || "模型返回错误",
        );
      if (protocol === "anthropic") {
        if (data.type === "content_block_start") {
          blockMap.set(data.index, structuredClone(data.content_block));
          const b = data.content_block;
          if (b.type === "tool_use")
            tool(data.index, {
              id: b.id,
              name: b.name,
              arguments:
                b.input && Object.keys(b.input).length
                  ? JSON.stringify(b.input)
                  : "",
            });
          else if (b.type === "text") add("text", b.text);
          else if (b.type === "thinking") add("reasoning", b.thinking);
        }
        if (data.type === "content_block_delta") {
          const d = data.delta,
            b = blockMap.get(data.index);
          if (d.type === "text_delta") {
            add("text", d.text);
            if (b) b.text = (b.text || "") + d.text;
          }
          if (d.type === "thinking_delta") {
            add("reasoning", d.thinking);
            if (b) b.thinking = (b.thinking || "") + d.thinking;
          }
          if (d.type === "signature_delta" && b)
            b.signature = (b.signature || "") + d.signature;
          if (d.type === "input_json_delta")
            tool(data.index, { arguments: d.partial_json });
        }
        if (data.message?.usage)
          usage = {
            input: data.message.usage.input_tokens || 0,
            output: data.message.usage.output_tokens || 0,
          };
        if (data.usage)
          usage = {
            input: usage?.input || 0,
            output: data.usage.output_tokens || 0,
          };
      } else if (protocol === "responses") {
        const type = data.type || event;
        if (type === "response.output_text.delta") add("text", data.delta);
        if (type === "response.reasoning_summary_text.delta")
          add("reasoning", data.delta);
        if (
          type === "response.output_item.added" &&
          data.item?.type === "function_call"
        )
          tool(data.output_index, {
            id: data.item.call_id,
            name: data.item.name,
            arguments: data.item.arguments,
          });
        if (type === "response.function_call_arguments.delta")
          tool(data.output_index, { arguments: data.delta });
        if (type === "response.output_item.done") {
          responseItems.set(data.output_index, data.item);
          if (data.item?.type === "function_call")
            calls.set(data.output_index, {
              id: data.item.call_id,
              name: data.item.name,
              arguments: data.item.arguments,
            });
        }
        if (type === "response.completed" || type === "response.incomplete") {
          const u = data.response?.usage;
          if (u)
            usage = {
              input: u.input_tokens || 0,
              output: u.output_tokens || 0,
            };
          if (type === "response.incomplete")
            onEvent({
              type: "reasoning",
              text: "\n[输出达到限制，可继续追问]\n",
            });
        }
        if (type === "response.failed")
          throw new Error(data.response?.error?.message || "模型请求失败");
      } else if (protocol === "google") {
        for (const part of data.candidates?.[0]?.content?.parts || []) {
          googleParts.push(structuredClone(part));
          if (part.text) add(part.thought ? "reasoning" : "text", part.text);
          if (part.functionCall) {
            const c = part.functionCall;
            tool(calls.size, {
              id: c.id || "call_" + crypto.randomUUID(),
              name: c.name,
              arguments: JSON.stringify(c.args || {}),
            });
          }
        }
        if (data.usageMetadata)
          usage = {
            input: data.usageMetadata.promptTokenCount || 0,
            output: data.usageMetadata.candidatesTokenCount || 0,
          };
      } else {
        const d = data.choices?.[0]?.delta || data.choices?.[0]?.message || {};
        add("text", typeof d.content === "string" ? d.content : "");
        add("reasoning", d.reasoning_content || d.reasoning || "");
        for (const [index, c] of (d.tool_calls || []).entries())
          tool(c.index ?? index, {
            id: c.id,
            name: c.function?.name,
            arguments: c.function?.arguments,
          });
        if (data.usage)
          usage = {
            input: data.usage.prompt_tokens || 0,
            output: data.usage.completion_tokens || 0,
          };
      }
    },
    result() {
      return {
        text,
        reasoning,
        calls: [...calls.values()].map((c) => ({
          ...c,
          id: c.id || "call_" + crypto.randomUUID(),
          arguments: c.arguments || "{}",
        })),
        usage,
        nativeAnthropic: [...blockMap.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([index, b]) =>
            b.type === "tool_use"
              ? { ...b, input: JSON.parse(calls.get(index)?.arguments || "{}") }
              : b,
          ),
        nativeResponses: [...responseItems.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, item]) => item),
        nativeGoogle: googleParts,
      };
    },
  };
}
module.exports = { endpoint, buildRequest, authHeaders, createCollector };
