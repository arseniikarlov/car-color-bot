import { Telegraf } from "telegraf";

import { handleCallbackQuery, handleCatalogCommand, handlePhotoMessage, handleResetCommand, handleSearchCommand, handleStart, handleTextMessage } from "./handlers.js";
import type { BotDeps } from "./handlers.js";

export function createBot(token: string, deps: BotDeps): Telegraf {
  const bot = new Telegraf(token);

  bot.start((ctx) => handleStart(ctx as any, deps));
  bot.command("catalog", (ctx) => handleCatalogCommand(ctx as any, deps, 0));
  bot.command("search", (ctx) => handleSearchCommand(ctx as any, deps));
  bot.command("reset", (ctx) => handleResetCommand(ctx as any, deps));

  bot.on("text", (ctx) => handleTextMessage(ctx as any, deps));
  bot.on("photo", (ctx) => handlePhotoMessage(ctx as any, deps));
  bot.on("callback_query", (ctx) => handleCallbackQuery(ctx as any, deps));

  bot.catch((error) => {
    console.error("Telegram bot error:", error);
  });

  return bot;
}
