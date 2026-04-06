import type { CatalogColor } from "../types.js";

export const UI_LABELS = {
  menuPickColor: "🎨 Подобрать цвет",
  menuSearch: "🔎 Найти цвет",
  menuReset: "↺ Начать заново",
  resultPickAnotherColor: "🎨 Выбрать другой цвет",
  resultUploadAnotherPhoto: "📷 Загрузить другое фото",
  resultBackToMenu: "🏠 В меню"
} as const;

type MainMenuAction = "pick_color" | "search" | "reset";

const MENU_ACTION_ALIASES: ReadonlyArray<{ text: string; action: MainMenuAction }> = [
  { text: UI_LABELS.menuPickColor, action: "pick_color" },
  { text: "Выбрать цвет", action: "pick_color" },
  { text: "Подобрать цвет", action: "pick_color" },
  { text: UI_LABELS.menuSearch, action: "search" },
  { text: "Поиск", action: "search" },
  { text: "Найти цвет", action: "search" },
  { text: UI_LABELS.menuReset, action: "reset" },
  { text: "Сбросить", action: "reset" },
  { text: "Начать заново", action: "reset" }
];

export function resolveMainMenuAction(rawText: string): MainMenuAction | null {
  const text = rawText.trim();
  const match = MENU_ACTION_ALIASES.find((item) => item.text === text);
  return match?.action ?? null;
}

export function buildUiMessage(input: {
  title: string;
  context: string;
  nextAction: string;
}): string {
  return [`${input.title}`, "", `${input.context}`, "", `Следующий шаг: ${input.nextAction}`].join("\n");
}

export const botCopy = {
  start(): string {
    return buildUiMessage({
      title: "✨ Добро пожаловать",
      context:
        "Помогу выбрать цвет из каталога и покажу превью перекраски Вашей машины по фото.",
      nextAction: `Нажмите «${UI_LABELS.menuPickColor}».`
    });
  },
  catalog(): string {
    return buildUiMessage({
      title: "🎨 Каталог цветов",
      context:
        "Выберите оттенок кнопкой ниже. После выбора сразу перейдем к загрузке фото машины.",
      nextAction: "Нажмите на подходящий цвет в списке."
    });
  },
  emptyCatalog(): string {
    return buildUiMessage({
      title: "📭 Каталог пока пуст",
      context:
        "Цвета еще не загружены. Импорт каталога выполняется администратором проекта.",
      nextAction: "Напишите администратору и повторите /catalog позже."
    });
  },
  search(): string {
    return buildUiMessage({
      title: "🔎 Поиск цвета",
      context: "Можно искать по коду или части названия. Пример: 040 или super white.",
      nextAction: "Отправьте запрос одним сообщением."
    });
  },
  reset(): string {
    return buildUiMessage({
      title: "↺ Готово, начали заново",
      context: "Я сбросил текущий сценарий. Теперь можно выбрать новый цвет или запустить поиск.",
      nextAction: `Нажмите «${UI_LABELS.menuPickColor}» или «${UI_LABELS.menuSearch}».`
    });
  },
  fallbackMenuHint(): string {
    return buildUiMessage({
      title: "🤝 Подскажу, что дальше",
      context:
        "Сейчас я жду выбор цвета, поиск или фото после выбора оттенка. Сообщение не потерял.",
      nextAction: "Выберите действие кнопками ниже."
    });
  },
  searchNoResults(query: string): string {
    return buildUiMessage({
      title: "Ничего не нашлось",
      context: `По запросу «${query}» пока нет совпадений в каталоге.`,
      nextAction: "Попробуйте другой код или часть названия."
    });
  },
  searchResults(count: number): string {
    return buildUiMessage({
      title: "Нашел варианты",
      context: `Подобрал ${count} цвет(а) по Вашему запросу.`,
      nextAction: "Выберите нужный цвет кнопкой."
    });
  },
  colorSelected(color: CatalogColor): string {
    const swatch = formatColorSwatchLabel(color);
    return buildUiMessage({
      title: "✅ Цвет выбран",
      context: `${color.code} · ${color.name}${swatch ? ` (${swatch})` : ""}.`,
      nextAction: "Отправьте фото одной машины с хорошо видимым кузовом."
    });
  },
  catalogImageCaption(color: CatalogColor): string {
    const swatch = formatColorSwatchLabel(color);
    return `Картинка из каталога: ${color.code} / ${color.name}${swatch ? ` (${swatch})` : ""}`;
  },
  uploadAnotherWithoutColor(): string {
    return buildUiMessage({
      title: "Сначала выберите цвет",
      context: "Чтобы продолжить, нужно снова выбрать оттенок из каталога.",
      nextAction: `Нажмите «${UI_LABELS.menuPickColor}».`
    });
  },
  uploadAnotherPhotoPrompt(): string {
    return buildUiMessage({
      title: "📷 Отлично, продолжаем",
      context: "Цвет уже выбран. Можно загрузить другое фото для нового превью.",
      nextAction: "Отправьте новое фото машины."
    });
  },
  selectColorBeforePhoto(): string {
    return buildUiMessage({
      title: "Сначала выберите цвет",
      context: "Пока не выбран оттенок, я не смогу корректно сделать превью перекраски.",
      nextAction: "Откройте каталог через /catalog или кнопку меню."
    });
  },
  photoMissing(): string {
    return buildUiMessage({
      title: "Фото не удалось прочитать",
      context: "Иногда Telegram присылает изображение в неподходящем формате.",
      nextAction: "Отправьте фото как обычное изображение в чат."
    });
  },
  photoTooLarge(maxInputImageMb: number): string {
    return buildUiMessage({
      title: "Файл слишком большой",
      context: `Лимит для входного фото: ${maxInputImageMb} MB.`,
      nextAction: "Сожмите фото и отправьте снова."
    });
  },
  processingPhoto(): string {
    return buildUiMessage({
      title: "🛠️ Готовлю превью",
      context: "Проверяю фото и запускаю перекраску. Обычно это занимает до минуты.",
      nextAction: "Пожалуйста, подождите немного."
    });
  },
  validationFailed(reason: string): string {
    const normalizedReason = normalizeReason(reason);
    return buildUiMessage({
      title: "Фото пока не подходит",
      context: normalizedReason
        ? `Причина: ${normalizedReason}.`
        : "На снимке не удалось уверенно распознать подходящую машину.",
      nextAction: "Пришлите другое фото: одна машина, хороший свет, кузов виден."
    });
  },
  previewCaption(color: CatalogColor): string {
    const swatch = formatColorSwatchLabel(color);
    return `Превью в цвете ${color.name} / код ${color.code}${swatch ? ` (${swatch})` : ""}`;
  },
  previewFailed(error: unknown): string {
    const text = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
    if (text.includes("timeout") || text.includes("timed out")) {
      return buildUiMessage({
        title: "Сервис занял больше времени",
        context: "Запрос на генерацию превью не успел завершиться вовремя.",
        nextAction: "Нажмите «📷 Загрузить другое фото» и попробуйте снова."
      });
    }

    return buildUiMessage({
      title: "Не получилось с первого раза",
      context: "Сервис обработки временно не вернул результат превью.",
      nextAction: "Нажмите «📷 Загрузить другое фото» и повторите попытку."
    });
  },
  answerCurrentPage(): string {
    return "Вы уже на этой странице";
  },
  answerColorSelected(): string {
    return "Цвет выбран";
  },
  answerColorNotFound(): string {
    return "Цвет не найден, выберите еще раз";
  }
};

export function formatColorSwatchLabel(color: {
  swatch_hex?: string;
  swatch_rgb?: { r: number; g: number; b: number };
}): string | null {
  if (color.swatch_hex) {
    return `HEX ${color.swatch_hex}`;
  }
  if (color.swatch_rgb) {
    return `RGB ${color.swatch_rgb.r},${color.swatch_rgb.g},${color.swatch_rgb.b}`;
  }
  return null;
}

function normalizeReason(reason: string): string {
  const cleaned = reason.replace(/\s+/gu, " ").trim();
  if (!cleaned) {
    return "";
  }

  const lower = cleaned.toLowerCase();
  if (
    lower.includes("invalid value") ||
    lower.includes("model") ||
    lower.includes("http") ||
    lower.includes("status")
  ) {
    return "";
  }

  return cleaned.slice(0, 200);
}
