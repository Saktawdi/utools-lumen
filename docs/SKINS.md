# 皮肤模块

主题决定浅色或深色；皮肤决定强调色及可选背景。设置 → 外观与皮肤中可导入、导出 JSON。

```json
{
  "id": "ocean",
  "name": "海盐",
  "description": "清澈蓝色与冷白纸面",
  "accent": "#326b95",
  "darkAccent": "#9fcef5",
  "background": "#f5f8fc",
  "darkBackground": "#182029"
}
```

`id`、`name`、`accent`、`darkAccent` 必填。颜色仅接受六位 `#RRGGBB`，背景可省略。相同 ID 会更新已有皮肤。导入前完整校验，失败不会替换当前设置。

皮肤仅提供数据，不执行 CSS 或脚本。强调色通过 `--accent`，背景通过 `--skin-bg` 应用；边框、悬浮、焦点和选中态继承语义 token。暗色强调色应足够明亮，浅色强调色应能在浅背景上阅读。

「跟随系统」会监听系统主题变化。「减少动态效果」和系统 `prefers-reduced-motion` 均会减少过渡。新皮肤建议检查聊天、代码、表格、设置表单、工具审批与键盘焦点。
