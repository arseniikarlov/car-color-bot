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
});
