# Privacy

Lumen is a local uTools plugin. It has no Lumen account, first-party proxy, or
telemetry endpoint. Model, search, and tool requests are made by the plugin to
the destinations configured by the user.

## Data stored locally

The uTools plugin data directory on Windows is `%APPDATA%\uTools\lumen`.
Provider settings, API keys, conversations, and the cached model capability
catalog are encrypted with AES-256-GCM. A randomly generated `vault.key` in
that same directory is needed to decrypt the data. Anyone with access to both
the key and encrypted files can read them. During use, the plugin decrypts data
in memory.

The model capability catalog is fetched from `https://models.dev/api.json`
and cached locally. This request does not include prompts or API keys.

## Data sent to external services

- Prompts, chosen model settings, and submitted text or image attachments are
  sent to the configured model provider. The provider's terms and privacy
  policy apply.
- Tool calls, search queries, and visited page URLs are sent to the services
  configured for those tools. HTTP tools send their configured request headers
  and body to their target.
- The built-in screenshot command copies the captured image to the local
  clipboard; the image is sent to a model only when the plugin submits it.
- JSON chat exports contain chat content. API keys and custom tool headers are
  excluded unless the user explicitly enables export with secrets.

No prompt, provider credential, or conversation is sent to a Lumen-operated
server.
