import { config as loadDotEnv } from "dotenv";
import path from "node:path";

loadDotEnv();

export interface AppConfig {
  telegramBotToken: string;
  openaiApiKey: string;
  catalogPath: string;
  sqlitePath: string;
  imageProvider: "openai" | "gemini" | "replicate";
  openaiVisionModel: string;
  openaiImageModel: string;
  geminiApiKey: string | null;
  geminiImageModel: string;
  geminiApiBase: string;
  replicateApiToken: string | null;
  replicateImageModel: string;
  replicateApiBase: string;
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
    imageProvider: parseImageProvider(process.env.IMAGE_PROVIDER),
    openaiVisionModel: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
    openaiImageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
    geminiApiKey: optionalEnv("GEMINI_API_KEY"),
    geminiImageModel: process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image-preview",
    geminiApiBase: process.env.GEMINI_API_BASE?.trim() || "https://generativelanguage.googleapis.com/v1beta",
    replicateApiToken: optionalEnv("REPLICATE_API_TOKEN"),
    replicateImageModel: process.env.REPLICATE_IMAGE_MODEL ?? "black-forest-labs/flux-kontext-pro",
    replicateApiBase: process.env.REPLICATE_API_BASE?.trim() || "https://api.replicate.com/v1",
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

function parseImageProvider(raw: string | undefined): "openai" | "gemini" | "replicate" {
  const value = raw?.trim().toLowerCase();
  if (!value || value === "openai") {
    return "openai";
  }
  if (value === "gemini") {
    return "gemini";
  }
  if (value === "replicate") {
    return "replicate";
  }
  throw new Error(`Invalid IMAGE_PROVIDER: ${raw}`);
}

function resolvePath(cwd: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}
