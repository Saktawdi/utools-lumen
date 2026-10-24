import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Settings } from "./types";
import { IconButton, cx } from "./ui";
import {
  addTranslationLanguage,
  languageName,
  removeTranslationLanguage,
} from "./quick-commands";

export default function TranslationLanguages({
  settings,
  update,
  notify,
}: {
  settings: Settings;
  update: (
    patch: Partial<Settings> | ((current: Settings) => Partial<Settings>),
  ) => void;
  notify: (message: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    try {
      // Validate before scheduling React's state updater, which must remain pure.
      addTranslationLanguage(settings, draft);
      update((current) => addTranslationLanguage(current, draft));
      setDraft("");
    } catch (error) {
      notify((error as Error).message);
    }
  };
  return (
    <div
      className="field"
      role="group"
      aria-labelledby="translation-language-label"
    >
      <span id="translation-language-label">翻译目标语言</span>
      <div className="translation-languages">
        {settings.translationLanguages.map((language) => {
          const selected = settings.translationLanguage === language;
          const name = languageName(language);
          return (
            <div
              className={cx("translation-language", selected && "selected")}
              key={language}
            >
              <label title={`设为默认：${name}`}>
                <input
                  type="radio"
                  name="translation-default"
                  aria-label={`默认翻译语言：${name}`}
                  checked={selected}
                  onChange={() => update({ translationLanguage: language })}
                />
                <span>{name}</span>
                {selected && <span className="language-default">默认</span>}
              </label>
              <IconButton
                label={
                  settings.translationLanguages.length === 1
                    ? "至少保留一种翻译语言"
                    : `删除翻译语言：${name}`
                }
                disabled={settings.translationLanguages.length === 1}
                onClick={() =>
                  update((current) =>
                    removeTranslationLanguage(current, language),
                  )
                }
              >
                <X size={13} />
              </IconButton>
            </div>
          );
        })}
      </div>
      <div className="row gap">
        <input
          aria-label="新增翻译语言"
          placeholder="语言代码或名称，如 pt、葡萄牙语"
          maxLength={80}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (draft.trim()) add();
            }
          }}
        />
        <button
          type="button"
          className="button"
          disabled={!draft.trim()}
          onClick={add}
        >
          <Plus size={14} />
          新增
        </button>
      </div>
    </div>
  );
}
