import { describe, expect, it } from "vitest";

import { botCopy, formatColorSwatchLabel, resolveMainMenuAction, UI_LABELS } from "../src/bot/copy.js";

describe("bot copy", () => {
  it("builds start message with clear next action", () => {
    const message = botCopy.start();
    expect(message).toContain("Добро пожаловать");
    expect(message).toContain("Следующий шаг:");
    expect(message).toContain(UI_LABELS.menuPickColor);
  });

  it("resolves both new and legacy main menu labels", () => {
    expect(resolveMainMenuAction(UI_LABELS.menuPickColor)).toBe("pick_color");
    expect(resolveMainMenuAction("Выбрать цвет")).toBe("pick_color");
    expect(resolveMainMenuAction(UI_LABELS.menuSearch)).toBe("search");
    expect(resolveMainMenuAction("Сбросить")).toBe("reset");
    expect(resolveMainMenuAction("случайный текст")).toBeNull();
  });

  it("formats swatch labels", () => {
    expect(formatColorSwatchLabel({ swatch_hex: "#FFFFFF" })).toBe("HEX #FFFFFF");
    expect(formatColorSwatchLabel({ swatch_rgb: { r: 1, g: 2, b: 3 } })).toBe("RGB 1,2,3");
    expect(formatColorSwatchLabel({})).toBeNull();
  });

  it("hides technical preview errors from user", () => {
    const message = botCopy.previewFailed(new Error("400 Invalid value: 'gpt-image-1'. Value must be 'dall-e-2'."));
    expect(message).toContain("Не получилось с первого раза");
    expect(message).not.toContain("400");
    expect(message).not.toContain("dall-e-2");
  });
});
