import { config as loadDotEnv } from "dotenv";
import path from "node:path";

loadDotEnv();

export interface AppConfig {
  telegramBotToken: string;
  openaiApiKey: string;
  catalogPath: string;
  sqlitePath: string;
  openaiVisionModel: string;
  openaiImageModel: string;
  maxInputImageMb: number;
  openaiTimeoutSec: number;
}

export interface ImportConfig {
  openaiApiKey: string | null;
  openaiVisionModel: string;
  catalogPath: string;
}

export function loadAppConfig(cwd = process.cwd()): AppConfig {
  const telegramBotToken = requiredEnv("TELEGRAM_BOT_TOKEN");
  const openaiApiKey = requiredEnv("OPENAI_API_KEY");
  const catalogPath = resolvePath(cwd, process.env.CATALOG_PATH ?? "./data/catalog.json");
  const sqlitePath = resolvePath(cwd, process.env.SQLITE_PATH ?? "./data/bot.sqlite");

  return {
    telegramBotToken,
    openaiApiKey,
    catalogPath,
    sqlitePath,
    openaiVisionModel: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
    openaiImageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
    maxInputImageMb: parsePositiveNumber(process.env.MAX_INPUT_IMAGE_MB, 10),
    openaiTimeoutSec: parsePositiveNumber(process.env.OPENAI_TIMEOUT_SEC, 90)
  };
}

export function loadImportConfig(cwd = process.cwd()): ImportConfig {
  return {
    openaiApiKey: optionalEnv("OPENAI_API_KEY"),
    openaiVisionModel: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
    catalogPath: resolvePath(cwd, process.env.CATALOG_PATH ?? "./data/catalog.json")
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive number: ${raw}`);
  }
  return parsed;
}

function resolvePath(cwd: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}
