import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { importImageCatalog } from "../src/catalog/importImageCatalog.js";

describe("importImageCatalog", () => {
  it("imports image file names as color codes and names", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "image-catalog-import-"));
    const sourceDir = path.join(tempDir, "JPG");
    const outputPath = path.join(tempDir, "data", "catalog.json");
    await mkdir(sourceDir, { recursive: true });

    await writeFile(path.join(sourceDir, ".DS_Store"), "ignored");
    await writeFile(path.join(sourceDir, "4001.jpg"), Buffer.from("image-1"));
    await writeFile(path.join(sourceDir, "4009M.jpg"), Buffer.from("image-2"));

    const result = await importImageCatalog(sourceDir, outputPath);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.code)).toEqual(["4001", "4009M"]);
    expect(result.items.map((item) => item.name)).toEqual(["4001", "4009M"]);
    expect(result.items[0]?.page_image).toBe("catalog_pages/4001.jpg");
    expect(result.items[1]?.page_image).toBe("catalog_pages/4009M.jpg");

    await access(path.join(tempDir, "data", "catalog_pages", "4001.jpg"));
    await access(path.join(tempDir, "data", "catalog_pages", "4009M.jpg"));
  });
});
