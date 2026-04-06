import { Markup } from "telegraf";

import type { CatalogColor } from "../types.js";
import { UI_LABELS } from "./copy.js";

export function mainMenuKeyboard() {
  return Markup.keyboard([[UI_LABELS.menuPickColor, UI_LABELS.menuSearch], [UI_LABELS.menuReset]]).resize();
}

export function catalogKeyboard(
  items: CatalogColor[],
  page: number,
  totalPages: number,
  pickKeyForColor: (item: CatalogColor) => string
) {
  const rows = items.map((item) => [
    Markup.button.callback(`${item.code} · ${item.name}`, `pick:${pickKeyForColor(item)}`)
  ]);

  const navRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (page > 0) {
    navRow.push(Markup.button.callback("◀ Назад", `page:${page - 1}`));
  }
  if (page + 1 < totalPages) {
    navRow.push(Markup.button.callback("Дальше ▶", `page:${page + 1}`));
  }
  if (navRow.length) {
    rows.push(navRow);
  }

  rows.push([Markup.button.callback(`Страница ${page + 1} из ${totalPages}`, "noop")]);
  return Markup.inlineKeyboard(rows);
}

export function searchResultsKeyboard(
  items: CatalogColor[],
  pickKeyForColor: (item: CatalogColor) => string
) {
  const rows = items.map((item) => [
    Markup.button.callback(`${item.code} · ${item.name}`, `pick:${pickKeyForColor(item)}`)
  ]);
  return Markup.inlineKeyboard(rows);
}

export function resultKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(UI_LABELS.resultPickAnotherColor, "choose_other")],
    [Markup.button.callback(UI_LABELS.resultUploadAnotherPhoto, "upload_other")],
    [Markup.button.callback(UI_LABELS.resultBackToMenu, "to_menu")]
  ]);
}
