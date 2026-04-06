import { access, writeFile } from "node:fs/promises";
import path from "node:path";

import { Input } from "telegraf";

import { CatalogIndex } from "../catalog/catalogIndex.js";
import type { OpenAIImageGateway } from "../types.js";
import { markAwaitingPhoto, markCompleted, markFailed, markProcessing, resetSession, selectColor, startSearch } from "../state/stateMachine.js";
import type { StateStore } from "../state/sqliteStateStore.js";
import { cleanupPath, createTempDir } from "../utils/tempFiles.js";
import { botCopy, resolveMainMenuAction } from "./copy.js";
import { catalogKeyboard, mainMenuKeyboard, resultKeyboard, searchResultsKeyboard } from "./keyboards.js";

const DEFAULT_PAGE_SIZE = 6;

export interface BotDeps {
  catalog: CatalogIndex;
  catalogBaseDir: string;
  stateStore: StateStore;
  openai: OpenAIImageGateway;
  maxInputImageMb: number;
  pageSize?: number;
}

interface UserRef {
  id: number;
}

interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
}

interface MinimalContext {
  from?: UserRef;
  message?: {
    text?: string;
    photo?: TelegramPhotoSize[];
  };
  callbackQuery?: {
    data?: string;
  };
  telegram: {
    getFileLink(fileId: string): Promise<URL>;
  };
  reply(text: string, extra?: unknown): Promise<unknown>;
  replyWithPhoto(photo: unknown, extra?: unknown): Promise<unknown>;
  editMessageText?(text: string, extra?: unknown): Promise<unknown>;
  answerCbQuery?(text?: string): Promise<unknown>;
}

export async function handleStart(ctx: MinimalContext, deps: BotDeps): Promise<void> {
  const userId = requireUserId(ctx);
  deps.stateStore.saveSession(resetSession(deps.stateStore.getSession(userId)));
  await ctx.reply(botCopy.start(), mainMenuKeyboard());
}

export async function handleCatalogCommand(ctx: MinimalContext, deps: BotDeps, page = 0): Promise<void> {
  const items = deps.catalog.listPage(page, deps.pageSize ?? DEFAULT_PAGE_SIZE);
  const totalPages = deps.catalog.pageCount(deps.pageSize ?? DEFAULT_PAGE_SIZE);
  const text = items.length ? botCopy.catalog() : botCopy.emptyCatalog();
  const keyboard = items.length
    ? catalogKeyboard(items, page, totalPages, (item) => deps.catalog.pickKeyForId(item.id) ?? item.id)
    : undefined;

  if (!ctx.callbackQuery || !ctx.editMessageText) {
    await ctx.reply(text, keyboard);
    return;
  }

  try {
    await ctx.editMessageText(text, keyboard);
  } catch {
    // If Telegram refuses editing (for example, non-bot message), send a new message instead.
    await ctx.reply(text, keyboard);
  }
}

export async function handleSearchCommand(ctx: MinimalContext, deps: BotDeps): Promise<void> {
  const userId = requireUserId(ctx);
  deps.stateStore.saveSession(startSearch(deps.stateStore.getSession(userId)));
  await ctx.reply(botCopy.search(), mainMenuKeyboard());
}

export async function handleResetCommand(ctx: MinimalContext, deps: BotDeps): Promise<void> {
  const userId = requireUserId(ctx);
  deps.stateStore.saveSession(resetSession(deps.stateStore.getSession(userId)));
  await ctx.reply(botCopy.reset(), mainMenuKeyboard());
}

export async function handleTextMessage(ctx: MinimalContext, deps: BotDeps): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text) {
    return;
  }
  if (text.startsWith("/")) {
    return;
  }

  const action = resolveMainMenuAction(text);
  if (action === "pick_color") {
    await handleCatalogCommand(ctx, deps, 0);
    return;
  }
  if (action === "search") {
    await handleSearchCommand(ctx, deps);
    return;
  }
  if (action === "reset") {
    await handleResetCommand(ctx, deps);
    return;
  }

  const userId = requireUserId(ctx);
  const session = deps.stateStore.getSession(userId);
  if (session.state !== "awaiting_search_query") {
    await ctx.reply(botCopy.fallbackMenuHint(), mainMenuKeyboard());
    return;
  }

  const matches = deps.catalog.search(text, 10);
  if (!matches.length) {
    await ctx.reply(botCopy.searchNoResults(text), mainMenuKeyboard());
    return;
  }

  await ctx.reply(
    botCopy.searchResults(matches.length),
    searchResultsKeyboard(matches, (item) => deps.catalog.pickKeyForId(item.id) ?? item.id)
  );
}

export async function handleCallbackQuery(ctx: MinimalContext, deps: BotDeps): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const userId = requireUserId(ctx);

  if (data === "noop") {
    await ctx.answerCbQuery?.(botCopy.answerCurrentPage());
    return;
  }
  if (data === "to_menu") {
    await ctx.answerCbQuery?.();
    await handleStart(ctx, deps);
    return;
  }
  if (data === "choose_other") {
    await ctx.answerCbQuery?.();
    await handleCatalogCommand(ctx, deps, 0);
    return;
  }
  if (data === "upload_other") {
    const session = deps.stateStore.getSession(userId);
    if (!session.selected_color_id) {
      await ctx.answerCbQuery?.();
      await ctx.reply(botCopy.uploadAnotherWithoutColor(), mainMenuKeyboard());
      return;
    }
    deps.stateStore.saveSession(markAwaitingPhoto(session));
    await ctx.answerCbQuery?.();
    await ctx.reply(botCopy.uploadAnotherPhotoPrompt(), resultKeyboard());
    return;
  }
  if (data.startsWith("page:")) {
    const page = Number(data.slice("page:".length));
    await ctx.answerCbQuery?.();
    await handleCatalogCommand(ctx, deps, Number.isFinite(page) ? page : 0);
    return;
  }
  if (data.startsWith("pick:")) {
    const pickKey = data.slice("pick:".length);
    const color = deps.catalog.getByPickKey(pickKey) ?? deps.catalog.getById(pickKey);
    if (!color) {
      await ctx.answerCbQuery?.(botCopy.answerColorNotFound());
      return;
    }
    const session = deps.stateStore.getSession(userId);
    deps.stateStore.saveSession(selectColor(session, color.id));
    await ctx.answerCbQuery?.(botCopy.answerColorSelected());
    const colorImagePath = await resolveCatalogImagePath(deps.catalogBaseDir, color.page_image);
    if (colorImagePath) {
      await ctx.replyWithPhoto(Input.fromLocalFile(colorImagePath), {
        caption: botCopy.catalogImageCaption(color)
      });
    }
    await ctx.reply(botCopy.colorSelected(color), resultKeyboard());
    return;
  }
}

export async function handlePhotoMessage(ctx: MinimalContext, deps: BotDeps): Promise<void> {
  const userId = requireUserId(ctx);
  const session = deps.stateStore.getSession(userId);
  const color = session.selected_color_id ? deps.catalog.getById(session.selected_color_id) : null;

  if (!color) {
    await ctx.reply(botCopy.selectColorBeforePhoto(), mainMenuKeyboard());
    return;
  }

  const photos = ctx.message?.photo ?? [];
  const largestPhoto = photos[photos.length - 1];
  if (!largestPhoto) {
    await ctx.reply(botCopy.photoMissing(), resultKeyboard());
    return;
  }

  const maxBytes = deps.maxInputImageMb * 1024 * 1024;
  if ((largestPhoto.file_size ?? 0) > maxBytes) {
    await ctx.reply(botCopy.photoTooLarge(deps.maxInputImageMb), resultKeyboard());
    return;
  }

  const tempDir = await createTempDir("car-color-bot-");
  const inputPath = path.join(tempDir, "input.jpg");

  deps.stateStore.saveSession(markProcessing(session, largestPhoto.file_id));
  await ctx.reply(botCopy.processingPhoto(), resultKeyboard());

  try {
    const fileUrl = await ctx.telegram.getFileLink(largestPhoto.file_id);
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to download Telegram file: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(inputPath, buffer);

    const validation = await deps.openai.validateCarPhoto(inputPath);
    if (!validation.is_valid) {
      deps.stateStore.saveSession(markFailed(deps.stateStore.getSession(userId), largestPhoto.file_id));
      await ctx.reply(botCopy.validationFailed(validation.reason), resultKeyboard());
      return;
    }

    const preview = await deps.openai.generatePreview(inputPath, color);
    deps.stateStore.saveSession(markCompleted(deps.stateStore.getSession(userId), largestPhoto.file_id));
    await ctx.replyWithPhoto(Input.fromLocalFile(preview.output_image_path), {
      caption: botCopy.previewCaption(color),
      ...resultKeyboard()
    });
  } catch (error) {
    console.error("Preview generation failed:", error);
    deps.stateStore.saveSession(markFailed(deps.stateStore.getSession(userId), largestPhoto.file_id));
    await ctx.reply(botCopy.previewFailed(error), resultKeyboard());
  } finally {
    await cleanupPath(tempDir);
  }
}

function requireUserId(ctx: MinimalContext): number {
  const userId = ctx.from?.id;
  if (!userId) {
    throw new Error("Telegram user is missing in context");
  }
  return userId;
}

async function resolveCatalogImagePath(
  catalogBaseDir: string,
  pageImageRelativePath: string | undefined
): Promise<string | null> {
  if (!pageImageRelativePath) {
    return null;
  }

  const absolutePath = path.resolve(catalogBaseDir, pageImageRelativePath);
  try {
    await access(absolutePath);
    return absolutePath;
  } catch {
    return null;
  }
}
