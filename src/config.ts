import { config as loadDotEnv } from "dotenv";
import path from "node:path";

loadDotEnv();

export interface AppConfig {
  telegramBotToken: string;
  catalogPath: string;
  sqlitePath: string;
  replicateApiToken: string | null;
  replicateImageModel: string;
  replicateApiBase: string;
  maxInputImageMb: number;
  aiTimeoutSec: number;
}

export interface ImportConfig {
  catalogPath: string;
}

export function loadAppConfig(cwd = process.cwd()): AppConfig {
  const telegramBotToken = requiredEnv("TELEGRAM_BOT_TOKEN");
  const catalogPath = resolvePath(cwd, process.env.CATALOG_PATH ?? "./data/catalog.json");
  const sqlitePath = resolvePath(cwd, process.env.SQLITE_PATH ?? "./data/bot.sqlite");

  return {
    telegramBotToken,
    catalogPath,
    sqlitePath,
    replicateApiToken: optionalEnv("REPLICATE_API_TOKEN"),
    replicateImageModel: process.env.REPLICATE_IMAGE_MODEL ?? "black-forest-labs/flux-kontext-pro",
    replicateApiBase: process.env.REPLICATE_API_BASE?.trim() || "https://api.replicate.com/v1",
    maxInputImageMb: parsePositiveNumber(process.env.MAX_INPUT_IMAGE_MB, 10),
    aiTimeoutSec: parsePositiveNumber(process.env.AI_TIMEOUT_SEC, 90)
  };
}

export function loadImportConfig(cwd = process.cwd()): ImportConfig {
  return {
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
