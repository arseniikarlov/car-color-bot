import path from "node:path";

import { createBot } from "./bot/createBot.js";
import { loadCatalog } from "./catalog/loadCatalog.js";
import { CatalogIndex } from "./catalog/catalogIndex.js";
import { loadAppConfig } from "./config.js";
import { AIService } from "./ai/aiService.js";
import { SQLiteStateStore } from "./state/sqliteStateStore.js";

async function main(): Promise<void> {
  const config = loadAppConfig(process.cwd());
  const catalog = await loadCatalog(config.catalogPath);
  const catalogIndex = new CatalogIndex(catalog.items);
  const stateStore = new SQLiteStateStore(config.sqlitePath);
  const ai = new AIService({
    visionModel: config.geminiVisionModel,
    imageProvider: config.imageProvider,
    geminiApiKey: config.geminiApiKey,
    geminiVisionModel: config.geminiVisionModel,
    geminiImageModel: config.geminiImageModel,
    geminiApiBase: config.geminiApiBase,
    replicateApiToken: config.replicateApiToken,
    replicateImageModel: config.replicateImageModel,
    replicateApiBase: config.replicateApiBase,
    timeoutMs: config.aiTimeoutSec * 1000
  });

  const bot = createBot(config.telegramBotToken, {
    catalog: catalogIndex,
    catalogBaseDir: path.dirname(config.catalogPath),
    stateStore,
    ai,
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
