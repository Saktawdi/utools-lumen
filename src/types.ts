export type Protocol = "openai" | "responses" | "anthropic" | "google";
export type ModelConfig = {
  vision?: boolean;
  reasoning?: boolean;
  tools?: boolean;
  context?: number;
  output?: number;
  levels?: string[];
  matchedId?: string;
  source?: string;
  reasoningMode?: "effort" | "toggle" | "budget";
  temperature?: number;
  maxTokens?: number;
};
export type Provider = {
  id: string;
  name: string;
  baseURL: string;
  protocol: Protocol;
  keys: string[];
  models: string[];
  availableModels: string[];
  modelConfigs: Record<string, ModelConfig>;
  defaultEffort?: string;
  enabled: boolean;
  headers?: Record<string, string>;
};
export type SearchConfig = {
  engine: "anysearch" | "tavily" | "searxng" | "custom";
  endpoint: string;
  keys: string[];
  keyMode: "bearer" | "x-api-key" | "body";
  limit: number;
  enabled: boolean;
};
export type Skin = {
  id: string;
  name: string;
  description: string;
  accent: string;
  darkAccent: string;
  background?: string;
  darkBackground?: string;
};
export type Attachment = {
  id: string;
  name: string;
  type: "image" | "text";
  mime: string;
  data: string;
  size: number;
};
export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
  result?: unknown;
  status: "running" | "done" | "error";
  duration?: number;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  attachments?: Attachment[];
  tools?: ToolCall[];
  model?: string;
  createdAt: number;
  error?: string;
  usage?: { input: number; output: number };
  interrupted?: boolean;
};
export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  modelKey?: string;
  effort?: string;
  pinned?: boolean;
};
export type ToolInfo = {
  name: string;
  title: string;
  description: string;
  group: string;
  enabled: boolean;
  inputSchema: Record<string, unknown>;
  approval?: boolean;
  custom?: boolean;
  endpoint?: string;
};
export type CustomTool = {
  name: string;
  title: string;
  description: string;
  group: string;
  inputSchema: Record<string, unknown>;
  endpoint: string;
  method: "POST" | "GET";
  headers?: Record<string, string>;
};
export type ToolPermissionMode = "prompt" | "always_allow";
export type Settings = {
  version: 1;
  providers: Provider[];
  search: SearchConfig;
  theme: "light" | "dark" | "system";
  skin: string;
  skins: Skin[];
  disabledTools: string[];
  toolPermission: ToolPermissionMode;
  customTools: CustomTool[];
  systemPrompt: string;
  translationLanguage: string;
  defaultModel?: string;
  sendKey: "enter" | "ctrl-enter";
  compact: boolean;
  reduceMotion: boolean;
};
export type AppState = {
  settings: Settings;
  conversations: Conversation[];
  activeId?: string;
};
export type StreamEvent = {
  type:
    | "text"
    | "reasoning"
    | "tool"
    | "tool-result"
    | "usage"
    | "error"
    | "done"
    | "approval"
    | "approval-resolved";
  text?: string;
  call?: ToolCall;
  id?: string;
  name?: string;
  args?: unknown;
  usage?: { input: number; output: number };
};
export type ModelEntry = {
  key: string;
  id: string;
  provider: Provider;
  config: ModelConfig;
};
export type Bridge = {
  load: () => Promise<AppState>;
  save: (state: AppState) => Promise<void>;
  models: (p: Provider) => Promise<string[]>;
  catalog: (force?: boolean) => Promise<Record<string, unknown>>;
  tools: () => Promise<ToolInfo[]>;
  onToolsChanged?: (fn: () => void) => () => void;
  chat: (
    args: {
      provider: Provider;
      model: string;
      config: ModelConfig;
      effort: string;
      messages: Message[];
      settings: Settings;
    },
    onEvent: (event: StreamEvent) => void,
  ) => Promise<void>;
  stop: () => void;
  approve: (id: string, allow: boolean) => void;
  setToolPermission: (mode: ToolPermissionMode) => Promise<void>;
  searchTest: (config: SearchConfig, query: string) => Promise<unknown>;
  exportFile: (name: string, content: string) => Promise<void>;
  openExternal: (url: string) => void;
  captureScreen?: () => Promise<string | null>;
  onEnter?: (fn: (entry: PluginEntry) => void) => () => void;
  onLeave?: (fn: () => void) => () => void;
};
export type PluginEntry = { code?: string; type: string; payload: unknown };
declare global {
  interface Window {
    lumenBootError?: string;
    lumen?: Bridge;
    utools?: unknown;
  }
}
