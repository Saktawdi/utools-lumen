const { request, assertOk, sse } = require("./transport.cjs");
const cursors = new Map();
async function withKeys(id, keys, operation) {
  const pool = [...new Set((keys || []).map((x) => x.trim()).filter(Boolean))];
  if (!pool.length) pool.push("");
  const start = (cursors.get(id) || 0) % pool.length;
  cursors.set(id, (start + 1) % pool.length);
  let last;
  for (let offset = 0; offset < pool.length; offset++) {
    try {
      return await operation(
        pool[(start + offset) % pool.length],
        (start + offset) % pool.length,
      );
    } catch (e) {
      last = e;
      if (
        e.name === "AbortError" ||
        ![401, 403, 408, 429, 500, 502, 503, 504].includes(e.status)
      )
        throw e;
    }
  }
  throw last;
}
async function rpc(url, headers, payload, signal) {
  const response = await assertOk(
    await request(url, {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream", ...headers },
      body: payload,
      signal,
    }),
  );
  let data;
  if (String(response.headers["content-type"]).includes("text/event-stream")) {
    for await (const item of sse(response.body)) {
      if (item.data.id === payload.id) {
        data = item.data;
        break;
      }
    }
  } else data = await response.json();
  if (data?.error) {
    const e = new Error(data.error.message || "AnySearch 请求失败");
    e.status = data.error.code === 42901 ? 429 : data.error.code;
    throw e;
  }
  return { data, session: response.headers["mcp-session-id"] };
}
async function webSearch(config, query, signal) {
  if (!query?.trim()) throw new Error("请输入搜索内容");
  if (!config.endpoint) throw new Error("请先配置搜索接口");
  const limit = Math.min(10, Math.max(1, Number(config.limit) || 5));
  return withKeys("search:" + config.endpoint, config.keys, async (key) => {
    const headers = key
      ? config.keyMode === "x-api-key"
        ? { "x-api-key": key }
        : config.keyMode === "body"
          ? {}
          : { Authorization: "Bearer " + key }
      : {};
    let data;
    if (config.engine === "anysearch") {
      headers["X-Anysearch-Client"] = "lumen/0.1.0";
      const init = await rpc(
        config.endpoint,
        headers,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "lumen-utools", version: "0.1.0" },
          },
        },
        signal,
      );
      const next = {
        ...headers,
        "MCP-Protocol-Version":
          init.data?.result?.protocolVersion || "2025-03-26",
        ...(init.session ? { "Mcp-Session-Id": init.session } : {}),
      };
      const notified = await request(config.endpoint, {
        method: "POST",
        headers: { Accept: "application/json, text/event-stream", ...next },
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
        signal,
      });
      await notified.text();
      const result = await rpc(
        config.endpoint,
        next,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "search", arguments: { query, max_results: limit } },
        },
        signal,
      );
      if (result.data?.result?.isError) {
        const message =
          result.data.result.content?.map((x) => x.text || "").join("\n") ||
          "搜索失败";
        const e = new Error(message);
        if (/rate|quota|exhausted|限流|额度/i.test(message)) e.status = 429;
        throw e;
      }
      const content = result.data?.result?.content || [];
      data = {
        query,
        content: content
          .filter((x) => x.type === "text")
          .map((x) => x.text)
          .join("\n"),
        source: "AnySearch",
      };
    } else if (config.engine === "searxng") {
      const url = new URL(config.endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      data = await (
        await assertOk(await request(url.toString(), { headers, signal }))
      ).json();
    } else {
      data = await (
        await assertOk(
          await request(config.endpoint, {
            method: "POST",
            headers,
            body: {
              query,
              max_results: limit,
              ...(config.keyMode === "body" && key ? { api_key: key } : {}),
            },
            signal,
          }),
        )
      ).json();
      if (typeof data.code === "number" && data.code !== 0) {
        const e = new Error(data.message || "搜索接口返回错误");
        e.status = data.code === 42901 ? 429 : data.code;
        throw e;
      }
    }
    if (data.results)
      return {
        query,
        results: data.results.slice(0, limit).map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content || r.snippet || r.description,
        })),
      };
    return data;
  });
}
module.exports = { webSearch, withKeys };
