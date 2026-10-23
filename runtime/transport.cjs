const http = require("node:http");
const https = require("node:https");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { execFileSync } = require("node:child_process");
let systemProxy;
function proxyFor(url) {
  if (/^(localhost|127\.|\[?::1)/i.test(new URL(url).hostname))
    return undefined;
  if (systemProxy === undefined) {
    systemProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
    if (!systemProxy && process.platform === "win32") {
      try {
        const text = execFileSync(
          "reg.exe",
          [
            "query",
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
          ],
          { encoding: "utf8", windowsHide: true, timeout: 1500 },
        );
        if (/ProxyEnable\s+REG_DWORD\s+0x1\b/.test(text)) {
          const raw = text
            .match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/)?.[1]
            ?.trim();
          const address =
            raw?.match(/(?:^|;)https=([^;]+)/)?.[1] ||
            raw?.split(";")[0]?.replace(/^http=/, "");
          if (address)
            systemProxy = /^\w+:\/\//.test(address)
              ? address
              : "http://" + address;
        }
      } catch {}
    }
  }
  return systemProxy ? new HttpsProxyAgent(systemProxy) : undefined;
}
function request(url, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (!["http:", "https:"].includes(target.protocol))
      return reject(new Error("仅支持 HTTP / HTTPS 地址"));
    const body =
      options.body === undefined
        ? undefined
        : typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body);
    const req = (target.protocol === "https:" ? https : http).request(
      target,
      {
        method: options.method || (body === undefined ? "GET" : "POST"),
        signal: options.signal,
        agent: target.protocol === "https:" ? proxyFor(url) : undefined,
        headers: {
          Accept: "application/json",
          ...(body !== undefined
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
          ...options.headers,
        },
      },
      (response) => {
        if (
          [301, 302, 303, 307, 308].includes(response.statusCode) &&
          response.headers.location
        ) {
          response.resume();
          if (redirects >= 4) return reject(new Error("重定向次数过多"));
          const next = new URL(response.headers.location, target);
          const headers = { ...options.headers };
          if (next.origin !== target.origin)
            for (const key of Object.keys(headers))
              if (/authorization|api.?key|cookie/i.test(key))
                delete headers[key];
          resolve(
            request(
              next.toString(),
              {
                ...options,
                headers,
                ...(response.statusCode === 303
                  ? { method: "GET", body: undefined }
                  : {}),
              },
              redirects + 1,
            ),
          );
          return;
        }
        const output = {
          status: response.statusCode,
          headers: response.headers,
          body: response,
          async text(max = 20 * 1024 * 1024) {
            let size = 0;
            const chunks = [];
            for await (const chunk of response) {
              size += chunk.length;
              if (size > max) {
                response.destroy();
                throw new Error("响应内容过大");
              }
              chunks.push(chunk);
            }
            return Buffer.concat(chunks).toString("utf8");
          },
          async json() {
            return JSON.parse(await this.text());
          },
        };
        resolve(output);
      },
    );
    req.setTimeout(90000, () =>
      req.destroy(new Error("连接超时，请检查供应商地址或网络")),
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
async function assertOk(response) {
  if (response.status >= 200 && response.status < 300) return response;
  const text = await response.text(1024 * 1024);
  let message;
  try {
    const data = JSON.parse(text);
    message = data.error?.message || data.message || data.detail || data.error;
  } catch {}
  const error = new Error(
    `HTTP ${response.status} · ${typeof message === "string" ? message.slice(0, 600) : "请求失败，请检查地址、密钥及额度"}`,
  );
  error.status = response.status;
  throw error;
}
async function* sse(body) {
  const decoder = new TextDecoder();
  let buffer = "",
    lines = [];
  function parse() {
    const data = lines
      .filter((x) => x.startsWith("data:"))
      .map((x) => x.slice(5).trimStart())
      .join("\n");
    const event = lines
      .find((x) => x.startsWith("event:"))
      ?.slice(6)
      .trim();
    lines = [];
    if (!data || data === "[DONE]") return null;
    try {
      return { event, data: JSON.parse(data) };
    } catch {
      throw new Error("流式响应格式无效，请检查接口协议");
    }
  }
  for await (const chunk of body) {
    buffer +=
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (line === "") {
        const item = parse();
        if (item) yield item;
      } else lines.push(line);
    }
  }
  buffer += decoder.decode();
  if (buffer) lines.push(buffer.replace(/\r$/, ""));
  if (lines.length) {
    const item = parse();
    if (item) yield item;
  }
}
module.exports = { request, assertOk, sse };
