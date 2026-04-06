import { describe, expect, it } from "vitest";

import { CatalogIndex } from "../src/catalog/catalogIndex.js";
import { parseCatalogPageText } from "../src/catalog/textParser.js";

describe("parseCatalogPageText", () => {
  it("extracts colors from page text", () => {
    const text = `
      Toyota
      Solid Colors
      040 Super White 2
      1F7 Silver Metallic
      3R3 Barcelona Red
    `;

    const items = parseCatalogPageText(text, 2, "/tmp/toyota.pdf");
    expect(items).toHaveLength(3);
    expect(items[0]?.brand).toBe("Toyota");
    expect(items[0]?.series).toBe("Solid Colors");
    expect(items[0]?.code).toBe("040");
    expect(items[0]?.name).toBe("Super White 2");
  });
});

describe("CatalogIndex", () => {
  it("searches by code and partial name", () => {
    const items = parseCatalogPageText(
      `
      Lexus
      Pearl
      077 Starfire Pearl
      1J7 Sonic Titanium
    `,
      1,
      "/tmp/lexus.pdf"
    );
    const index = new CatalogIndex(items);

    expect(index.search("077")[0]?.name).toBe("Starfire Pearl");
    expect(index.search("titan")[0]?.code).toBe("1J7");
  });
});
