import type {
  AppState,
  Conversation,
  ConversationAction,
  ConversationCommand,
  ConversationGroup,
} from "./types";

export const conversationColors = [
  { name: "绿色", value: "#4d9d80" },
  { name: "青色", value: "#399aab" },
  { name: "蓝色", value: "#638ed5" },
  { name: "紫色", value: "#a086cf" },
  { name: "琥珀", value: "#c99440" },
  { name: "玫红", value: "#cc728e" },
  { name: "珊瑚", value: "#d17a60" },
  { name: "灰色", value: "#88948d" },
] as const;
export const GROUP_NAME_MAX = 24;
export const CONVERSATION_TITLE_MAX = 100;
export const isConversationColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[a-f\d]{6}$/i.test(value);
const nameOf = (value: unknown, max: number, label: string) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /[\x00-\x1f]/.test(value)
  )
    throw new Error(`${label}需要 1–${max} 个字符`);
  return value.trim();
};
export function parseConversationGroup(value: unknown): ConversationGroup {
  const g = value as ConversationGroup;
  if (
    !g ||
    typeof g.id !== "string" ||
    !g.id ||
    g.id.length > 100 ||
    (g.collapsed !== undefined && typeof g.collapsed !== "boolean") ||
    !isConversationColor(g.color)
  )
    throw new Error("分组格式无效");
  return {
    id: g.id,
    name: nameOf(g.name, GROUP_NAME_MAX, "分组名称"),
    color: g.color,
    collapsed: g.collapsed === true,
  };
}
export function orderedConversations(
  state: Pick<AppState, "conversations" | "conversationOrder">,
): Conversation[] {
  const positions = new Map(
    (state.conversationOrder || []).map((id, i) => [id, i]),
  );
  return [...state.conversations].sort(
    (a, b) =>
      Number(!!b.pinned) - Number(!!a.pinned) ||
      (positions.get(a.id) ?? -1) - (positions.get(b.id) ?? -1) ||
      b.updatedAt - a.updatedAt,
  );
}
export function applyConversationAction(
  state: AppState,
  action: ConversationAction,
): AppState {
  const groups = state.conversationGroups;
  const requireGroup = (id: string) => {
    const group = groups.find((g) => g.id === id);
    if (!group) throw new Error("分组已不存在，请重新选择");
    return group;
  };
  const requireConversation = (id: string) => {
    const conversation = state.conversations.find((c) => c.id === id);
    if (!conversation) throw new Error("会话已不存在");
    return conversation;
  };
  const patch = (id: string, value: Partial<Conversation>) => ({
    ...state,
    conversations: state.conversations.map((c) =>
      c.id === id ? { ...c, ...value } : c,
    ),
  });
  switch (action.type) {
    case "group-create": {
      const group = parseConversationGroup(action.group);
      if (
        groups.some(
          (g) =>
            g.id === group.id ||
            g.name.toLocaleLowerCase() === group.name.toLocaleLowerCase(),
        )
      )
        throw new Error("已存在同名分组");
      if (groups.length >= 200) throw new Error("最多创建 200 个分组");
      if (action.conversationId) requireConversation(action.conversationId);
      return {
        ...state,
        conversationGroups: [...groups, group],
        conversations: action.conversationId
          ? state.conversations.map((c) =>
              c.id === action.conversationId ? { ...c, groupId: group.id } : c,
            )
          : state.conversations,
      };
    }
    case "group-edit": {
      requireGroup(action.id);
      const group = parseConversationGroup({
        ...requireGroup(action.id),
        name: action.name,
        color: action.color,
      });
      if (
        groups.some(
          (g) =>
            g.id !== group.id &&
            g.name.toLocaleLowerCase() === group.name.toLocaleLowerCase(),
        )
      )
        throw new Error("已存在同名分组");
      return {
        ...state,
        conversationGroups: groups.map((g) => (g.id === group.id ? group : g)),
      };
    }
    case "group-delete":
      requireGroup(action.id);
      return {
        ...state,
        conversationGroups: groups.filter((g) => g.id !== action.id),
        conversations: state.conversations.map((c) =>
          c.groupId === action.id ? { ...c, groupId: undefined } : c,
        ),
      };
    case "group-collapse":
      if (!action.id) return { ...state, ungroupedCollapsed: action.collapsed };
      requireGroup(action.id);
      return {
        ...state,
        conversationGroups: groups.map((g) =>
          g.id === action.id ? { ...g, collapsed: action.collapsed } : g,
        ),
      };
    case "collapse-all":
      return {
        ...state,
        ungroupedCollapsed: action.collapsed,
        conversationGroups: groups.map((g) => ({
          ...g,
          collapsed: action.collapsed,
        })),
      };
    case "group-reorder": {
      const group = requireGroup(action.id);
      requireGroup(action.targetId);
      if (action.id === action.targetId) return state;
      const next = groups.filter((g) => g.id !== action.id);
      next.splice(
        next.findIndex((g) => g.id === action.targetId) + Number(action.after),
        0,
        group,
      );
      return { ...state, conversationGroups: next };
    }
    case "rename":
      requireConversation(action.id);
      return patch(action.id, {
        title: nameOf(action.title, CONVERSATION_TITLE_MAX, "会话名称"),
      });
    case "color":
      requireConversation(action.id);
      if (action.color && !isConversationColor(action.color))
        throw new Error("标记颜色需要 #RRGGBB 格式");
      return patch(action.id, { color: action.color || undefined });
    case "move": {
      requireConversation(action.id);
      if (action.groupId) requireGroup(action.groupId);
      const next = patch(action.id, { groupId: action.groupId || undefined });
      return applyConversationAction(next, {
        type: "group-collapse",
        id: action.groupId,
        collapsed: false,
      });
    }
    case "pin":
      requireConversation(action.id);
      return patch(action.id, { pinned: action.pinned });
    case "archive":
      requireConversation(action.id);
      return {
        ...patch(action.id, { archived: action.archived, unread: false }),
        activeId:
          state.activeId === action.id && action.archived
            ? undefined
            : state.activeId,
      };
    case "unread":
      requireConversation(action.id);
      return patch(action.id, { unread: action.unread });
    case "delete":
      requireConversation(action.id);
      return {
        ...state,
        activeId: state.activeId === action.id ? undefined : state.activeId,
        conversations: state.conversations.filter((c) => c.id !== action.id),
        conversationOrder: state.conversationOrder.filter(
          (id) => id !== action.id,
        ),
      };
    case "reorder": {
      const source = requireConversation(action.id);
      const target = requireConversation(action.targetId);
      if (source.id === target.id) return state;
      if (!!source.archived !== !!target.archived)
        throw new Error("请在同一个会话列表内排序");
      // Crossing groups preserves pinning; crossing zones within a group adopts the target zone.
      const next = patch(source.id, {
        groupId: target.groupId,
        pinned:
          source.groupId === target.groupId ? target.pinned : source.pinned,
      });
      const order = orderedConversations(state)
        .map((c) => c.id)
        .filter((id) => id !== source.id);
      order.splice(
        order.indexOf(target.id) + Number(action.after),
        0,
        source.id,
      );
      return { ...next, conversationOrder: order };
    }
    default:
      throw new Error("不支持的会话操作");
  }
}
export function conversationCommand(
  state: AppState,
  command: ConversationCommand,
): { state: AppState; result: unknown } {
  if (command.type === "groups")
    return {
      state,
      result: state.conversationGroups.map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        count: state.conversations.filter((c) => c.groupId === g.id).length,
      })),
    };
  if (command.type === "current") {
    const c = state.conversations.find((c) => c.id === command.id);
    if (!c) throw new Error("当前会话已不存在");
    const g = state.conversationGroups.find((g) => g.id === c.groupId);
    return {
      state,
      result: {
        id: c.id,
        title: c.title,
        groupId: g?.id || null,
        groupName: g?.name || null,
        color: c.color || null,
        pinned: !!c.pinned,
        archived: !!c.archived,
      },
    };
  }
  const next = applyConversationAction(state, command);
  const result =
    command.type === "group-create"
      ? next.conversationGroups.find((g) => g.id === command.group.id)
      : "id" in command &&
          command.id &&
          next.conversations.some((c) => c.id === command.id)
        ? conversationCommand(next, { type: "current", id: command.id }).result
        : { success: true };
  return { state: next, result };
}
