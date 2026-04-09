import { describe, expect, it } from "vitest";

import { CatalogIndex } from "../src/catalog/catalogIndex.js";
import { parseCatalogPageText } from "../src/catalog/textParser.js";
import { handleCallbackQuery, handlePhotoMessage, handleSearchCommand, handleStart, handleTextMessage } from "../src/bot/handlers.js";
import type { ImageGateway, PreviewResult, PhotoValidationResult } from "../src/types.js";
import { defaultSession } from "../src/state/stateMachine.js";

class MemoryStateStore {
  private readonly sessions = new Map<number, ReturnType<typeof defaultSession>>();

  getSession(telegramUserId: number) {
    const existing = this.sessions.get(telegramUserId);
    if (existing) {
      return existing;
    }
    const created = defaultSession(telegramUserId);
    this.sessions.set(telegramUserId, created);
    return created;
  }

  saveSession(session: ReturnType<typeof defaultSession>) {
    this.sessions.set(session.telegram_user_id, session);
  }

  close() {}
}

function createCtx(overrides: Record<string, unknown> = {}) {
  const replies: string[] = [];
  const chatActions: string[] = [];
  const ctx = {
    from: { id: 7 },
    telegram: {
      async getFileLink() {
        return new URL("https://example.com/file.jpg");
      }
    },
    async sendChatAction(action: string) {
      chatActions.push(action);
    },
    async reply(text: string) {
      replies.push(text);
    },
    async replyWithPhoto() {
      replies.push("photo");
    },
    async answerCbQuery() {},
    async editMessageText(text: string) {
      replies.push(`edit:${text}`);
    },
    ...overrides
  };
  return { ctx, replies, chatActions };
}

describe("bot handlers", () => {
  const catalog = new CatalogIndex(
    parseCatalogPageText(
      `
        Toyota
        Solid
        040 Super White
        1F7 Silver Metallic
      `,
      1,
      "/tmp/colors.pdf"
    )
  );

  it("runs start and search flow", async () => {
    const store = new MemoryStateStore();
    const ai: ImageGateway = {
      async validateCarPhoto(): Promise<PhotoValidationResult> {
        return { is_valid: true, reason: "", view: "front", issues: [] };
      },
      async generatePreview(): Promise<PreviewResult> {
        return { output_image_path: "/tmp/output.png", prompt_version: "v1", model: "gpt-image-1" };
      },
      async extractCatalogColorsFromImage() {
        return { brand: "", series: "", items: [] };
      }
    };
    const deps = { catalog, catalogBaseDir: "/tmp", stateStore: store as any, ai, maxInputImageMb: 10 };

    const { ctx, replies } = createCtx();
    await handleStart(ctx as any, deps);
    await handleSearchCommand(ctx as any, deps);
    ctx.message = { text: "040" };
    await handleTextMessage(ctx as any, deps);

    expect(replies[0]).toContain("Добро пожаловать");
    expect(replies[1]).toContain("Поиск цвета");
    expect(replies[2]).toContain("Нашел варианты");
  });

  it("handles color selection and invalid photo", async () => {
    const store = new MemoryStateStore();
    const ai: ImageGateway = {
      async validateCarPhoto(): Promise<PhotoValidationResult> {
        return { is_valid: false, reason: "Too dark", view: "rear", issues: ["dark"] };
      },
      async generatePreview(): Promise<PreviewResult> {
        throw new Error("should not generate preview");
      },
      async extractCatalogColorsFromImage() {
        return { brand: "", series: "", items: [] };
      }
    };
    const deps = { catalog, catalogBaseDir: "/tmp", stateStore: store as any, ai, maxInputImageMb: 10 };
    const firstColor = catalog.listPage(0, 10)[0]!;
    const firstColorPickKey = catalog.pickKeyForId(firstColor.id)!;

    const { ctx, replies, chatActions } = createCtx({
      callbackQuery: { data: `pick:${firstColorPickKey}` },
      message: {
        photo: [{ file_id: "f1", file_size: 1_000 }]
      }
    });

    await handleCallbackQuery(ctx as any, deps);

    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" }
      })) as typeof fetch;

    try {
      await handlePhotoMessage(ctx as any, deps);
    } finally {
      global.fetch = originalFetch;
    }

    expect(replies[0]).toContain("Цвет выбран");
    expect(replies[1]).toContain("Готовлю превью");
    expect(replies[2]).toContain("Фото пока не подходит");
    expect(chatActions).toContain("upload_photo");
  });

  it("returns user to menu from result actions", async () => {
    const store = new MemoryStateStore();
    const ai: ImageGateway = {
      async validateCarPhoto(): Promise<PhotoValidationResult> {
        return { is_valid: true, reason: "", view: "front", issues: [] };
      },
      async generatePreview(): Promise<PreviewResult> {
        return { output_image_path: "/tmp/output.png", prompt_version: "v1", model: "gpt-image-1" };
      },
      async extractCatalogColorsFromImage() {
        return { brand: "", series: "", items: [] };
      }
    };
    const deps = { catalog, catalogBaseDir: "/tmp", stateStore: store as any, ai, maxInputImageMb: 10 };
    const { ctx, replies } = createCtx({
      callbackQuery: { data: "to_menu" }
    });

    await handleCallbackQuery(ctx as any, deps);
    expect(replies[0]).toContain("Добро пожаловать");
  });
});
