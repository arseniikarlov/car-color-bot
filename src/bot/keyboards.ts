import { Markup } from "telegraf";

import type { CatalogColor } from "../types.js";

export function mainMenuKeyboard() {
  return Markup.keyboard([["Выбрать цвет", "Поиск"], ["Сбросить"]]).resize();
}

export function catalogKeyboard(items: CatalogColor[], page: number, totalPages: number) {
  const rows = items.map((item) => [
    Markup.button.callback(`${item.code} · ${item.name}`, `pick:${item.id}`)
  ]);

  const navRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (page > 0) {
    navRow.push(Markup.button.callback("← Назад", `page:${page - 1}`));
  }
  if (page + 1 < totalPages) {
    navRow.push(Markup.button.callback("Дальше →", `page:${page + 1}`));
  }
  if (navRow.length) {
    rows.push(navRow);
  }

  rows.push([Markup.button.callback(`Стр. ${page + 1}/${totalPages}`, "noop")]);
  return Markup.inlineKeyboard(rows);
}

export function searchResultsKeyboard(items: CatalogColor[]) {
  const rows = items.map((item) => [
    Markup.button.callback(`${item.code} · ${item.name}`, `pick:${item.id}`)
  ]);
  return Markup.inlineKeyboard(rows);
}

export function resultKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Выбрать другой цвет", "choose_other")],
    [Markup.button.callback("Загрузить другое фото", "upload_other")]
  ]);
}
