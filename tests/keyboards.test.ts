import { describe, expect, it } from "vitest";

import { UI_LABELS } from "../src/bot/copy.js";
import { catalogKeyboard, mainMenuKeyboard, resultKeyboard } from "../src/bot/keyboards.js";
import type { CatalogColor } from "../src/types.js";

describe("keyboards", () => {
  it("renders humanized main menu labels", () => {
    const keyboard = mainMenuKeyboard() as unknown as {
      reply_markup?: {
        keyboard?: Array<Array<string | { text?: string }>>;
      };
    };

    const cells = keyboard.reply_markup?.keyboard ?? [];
    const texts = cells.flat().map((item) => (typeof item === "string" ? item : item.text ?? ""));

    expect(texts).toContain(UI_LABELS.menuPickColor);
    expect(texts).toContain(UI_LABELS.menuSearch);
    expect(texts).toContain(UI_LABELS.menuReset);
  });

  it("renders catalog pagination status in readable format", () => {
    const items: CatalogColor[] = [
      {
        id: "a",
        brand: "Toyota",
        series: "Solid",
        code: "040",
        name: "Super White",
        page: 1,
        source_pdf: "colors.pdf",
        search_tokens: ["040", "super", "white"]
      }
    ];

    const keyboard = catalogKeyboard(items, 0, 3, () => "pick1") as unknown as {
      reply_markup?: {
        inline_keyboard?: Array<Array<{ text?: string; callback_data?: string }>>;
      };
    };
    const buttons = (keyboard.reply_markup?.inline_keyboard ?? []).flat();
    const labels = buttons.map((item) => item.text ?? "");

    expect(labels).toContain("Страница 1 из 3");
    expect(buttons.some((item) => item.callback_data === "pick:pick1")).toBe(true);
  });

  it("includes all result action buttons including menu return", () => {
    const keyboard = resultKeyboard() as unknown as {
      reply_markup?: {
        inline_keyboard?: Array<Array<{ text?: string; callback_data?: string }>>;
      };
    };

    const buttons = (keyboard.reply_markup?.inline_keyboard ?? []).flat();
    const callbackData = buttons.map((item) => item.callback_data ?? "");
    const labels = buttons.map((item) => item.text ?? "");

    expect(callbackData).toContain("choose_other");
    expect(callbackData).toContain("upload_other");
    expect(callbackData).toContain("to_menu");
    expect(labels).toContain(UI_LABELS.resultBackToMenu);
  });
});
