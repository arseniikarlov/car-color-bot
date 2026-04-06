import { mkdtemp, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { importCatalog } from "../src/catalog/importCatalog.js";
import type { OpenAIImageGateway } from "../src/types.js";

describe("importCatalog", () => {
  it("uses text extraction first and vision fallback when needed", async () => {
    const fakeOpenAI: OpenAIImageGateway = {
      async validateCarPhoto() {
        throw new Error("not used");
      },
      async generatePreview() {
        throw new Error("not used");
      },
      async extractCatalogColorsFromImage() {
        return {
          brand: "BMW",
          series: "Frozen",
          items: [{ code: "C1X", name: "Frozen Deep Grey" }]
        };
      }
    };

    const writes: string[] = [];
    const result = await importCatalog("/tmp/colors.pdf", "/tmp/out/catalog.json", {
      async extractTexts() {
        return [
          `
            Toyota
            Solid
            040 Super White
          `,
          ""
        ];
      },
      async renderPages() {
        return ["/tmp/page-1.png", "/tmp/page-2.png"];
      },
      openai: fakeOpenAI
    });

    writes.push(JSON.stringify(result.items));
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.code).toBe("040");
    expect(result.items[1]?.code).toBe("C1X");
    expect(result.warnings).toEqual([]);
    expect(writes[0]).toContain("Frozen Deep Grey");
  });

  it("stores catalog page images and links them to colors", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "catalog-import-"));
    const page1 = path.join(tempDir, "page-1.png");
    const page2 = path.join(tempDir, "page-2.png");
    await writeFile(page1, Buffer.from("fake-image-1"));
    await writeFile(page2, Buffer.from("fake-image-2"));

    const outputPath = path.join(tempDir, "out", "catalog.json");
    const result = await importCatalog("/tmp/colors.pdf", outputPath, {
      async extractTexts() {
        return [
          `
            Brand A
            Series A
            A10 Bright Red
          `,
          `
            Brand B
            Series B
            B20 Deep Blue
          `
        ];
      },
      async renderPages() {
        return [page1, page2];
      },
      openai: null
    });

    const first = result.items.find((item) => item.code === "A10");
    const second = result.items.find((item) => item.code === "B20");

    expect(first?.page_image).toBe("catalog_pages/page-001.png");
    expect(second?.page_image).toBe("catalog_pages/page-002.png");
    await access(path.join(tempDir, "out", "catalog_pages", "page-001.png"));
    await access(path.join(tempDir, "out", "catalog_pages", "page-002.png"));
  });
});
