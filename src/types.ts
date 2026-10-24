export type Protocol = "openai" | "responses" | "anthropic" | "google";
export type TokenUsage = {
  input: number;
  output: number;
  cachedInput?: number;
  cacheWrite?: number;
  reasoning?: number;
};
export type ImageProvider = {
  id: string;
  name: string;
  protocol: "openai-images" | "google-images";
  baseURL: string;
  keys: string[];
  models: string[];
  availableModels: string[];
  enabled: boolean;
  headers?: Record<string, string>;
};
export type ImageAsset = {
  id: string;
  mime: string;
  size: number;
  revisedPrompt?: string;
};
export type ImageRequest = {
  id: string;
  provider: ImageProvider;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  count: number;
  background: string;
  references: Attachment[];
  source?: "studio" | "agent";
};
export type ImageJob = {
  id: string;
  providerId: string;
  providerName: string;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  count: number;
  background: string;
  status: "running" | "done" | "error" | "cancelled";
  createdAt: number;
  completedAt?: number;
  error?: string;
  images: ImageAsset[];
  source: "studio" | "agent";
  favorite?: boolean;
  referenceCount: number;
  references?: ImageAsset[];
};
export type UsageRecord = TokenUsage & {
  id: string;
  startedAt: number;
  completedAt: number;
  providerId: string;
  providerName: string;
  model: string;
  kind: "chat" | "image";
  status: "success" | "error" | "cancelled";
  reported: boolean;
  images?: number;
  legacy?: boolean;
};
export type UsageData = { records: UsageRecord[]; since: number };
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
  custom?: boolean;
  backgroundImage?: string;
  backgroundBlur?: number;
  backgroundOpacity?: number;
  backgroundPosition?: "center" | "top" | "bottom";
  bubbleStyle?: "soft" | "outline" | "minimal";
  bubbleRadius?: number;
  bubbleOpacity?: number;
  userBubble?: string;
  darkUserBubble?: string;
  agentBubble?: string;
  darkAgentBubble?: string;
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
  usage?: TokenUsage;
  generatedImages?: ImageAsset[];
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
  imageProviders: ImageProvider[];
  defaultImageModel?: string;
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
  chatLayout: "split" | "single";
  userAvatar?: string;
  agentAvatar?: string;
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
    | "images"
    | "error"
    | "done"
    | "approval"
    | "approval-resolved";
  text?: string;
  call?: ToolCall;
  id?: string;
  name?: string;
  args?: unknown;
  usage?: TokenUsage;
  images?: ImageAsset[];
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
  imageGenerate: (request: ImageRequest) => Promise<ImageJob>;
  imageJobs: () => Promise<ImageJob[]>;
  imageAsset: (id: string, thumbnail?: boolean) => Promise<string>;
  imageThumbnail: (id: string, data: string) => Promise<void>;
  imageCancel: (id: string) => Promise<void>;
  imageRemove: (id: string) => Promise<void>;
  imageFavorite: (id: string, favorite: boolean) => Promise<void>;
  usage: () => Promise<UsageData>;
  saveImage: (id: string) => Promise<void>;
  copyImage: (id: string) => Promise<void>;
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
