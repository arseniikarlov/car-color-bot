import path from "node:path";

import { createBot } from "./bot/createBot.js";
import { loadCatalog } from "./catalog/loadCatalog.js";
import { CatalogIndex } from "./catalog/catalogIndex.js";
import { loadAppConfig } from "./config.js";
import { OpenAIService } from "./openai/openAIService.js";
import { SQLiteStateStore } from "./state/sqliteStateStore.js";

async function main(): Promise<void> {
  const config = loadAppConfig(process.cwd());
  const catalog = await loadCatalog(config.catalogPath);
  const catalogIndex = new CatalogIndex(catalog.items);
  const stateStore = new SQLiteStateStore(config.sqlitePath);
  const openai = new OpenAIService({
    apiKey: config.openaiApiKey,
    visionModel: config.openaiVisionModel,
    imageModel: config.openaiImageModel,
    imageProvider: config.imageProvider,
    geminiApiKey: config.geminiApiKey,
    geminiImageModel: config.geminiImageModel,
    geminiApiBase: config.geminiApiBase,
    timeoutMs: config.openaiTimeoutSec * 1000
  });

  const bot = createBot(config.telegramBotToken, {
    catalog: catalogIndex,
    catalogBaseDir: path.dirname(config.catalogPath),
    stateStore,
    openai,
    maxInputImageMb: config.maxInputImageMb
  });

  const shutdown = async () => {
    stateStore.close();
    await bot.stop();
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  await bot.launch();
  console.log(`Bot started. Loaded ${catalogIndex.total()} colors from ${config.catalogPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
