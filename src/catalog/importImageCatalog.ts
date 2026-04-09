import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CatalogColor, CatalogImportResult } from "../types.js";
import { deduplicateColors, toCatalogColor } from "./catalogUtils.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export async function importImageCatalog(sourceDirPath: string, outputPath: string): Promise<CatalogImportResult> {
  const entries = await readdir(sourceDirPath, { withFileTypes: true });
  const warnings: string[] = [];
  const imageFiles = entries
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true, sensitivity: "base" }));

  if (!imageFiles.length) {
    throw new Error(`No supported image files found in directory: ${sourceDirPath}`);
  }

  const outputDir = path.dirname(outputPath);
  const imagesDirName = "catalog_pages";
  const imagesDirPath = path.join(outputDir, imagesDirName);
  await mkdir(imagesDirPath, { recursive: true });

  const items: CatalogColor[] = [];
  const usedTargetFileNames = new Set<string>();

  for (let index = 0; index < imageFiles.length; index += 1) {
    const fileName = imageFiles[index]!;
    const extension = path.extname(fileName).toLowerCase();
    const baseName = path.basename(fileName, extension).trim();
    const colorCode = normalizeColorCode(baseName);
    if (!colorCode) {
      warnings.push(`Skipped ${fileName}: empty color code in file name.`);
      continue;
    }

    const sourceImagePath = path.join(sourceDirPath, fileName);
    const targetFileName = buildUniqueFileName(`${colorCode}${extension}`, usedTargetFileNames);
    const targetImagePath = path.join(imagesDirPath, targetFileName);
    await copyFile(sourceImagePath, targetImagePath);

    items.push(
      toCatalogColor({
        brand: "JPG Catalog",
        series: "File Names",
        code: colorCode,
        name: colorCode,
        page: index + 1,
        sourcePdf: path.basename(sourceDirPath),
        pageImage: path.posix.join(imagesDirName, targetFileName)
      })
    );
  }

  const deduplicated = deduplicateColors(items);
  const result: CatalogImportResult = {
    source_pdf: path.basename(sourceDirPath),
    generated_at: new Date().toISOString(),
    items: deduplicated,
    warnings
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        source_pdf: result.source_pdf,
        generated_at: result.generated_at,
        items: result.items
      },
      null,
      2
    )
  );

  return result;
}

function normalizeColorCode(value: string): string {
  const normalized = value
    .toUpperCase()
    .replace(/\s+/gu, "")
    .replace(/[^A-Z0-9_-]/gu, "");
  return normalized;
}

function buildUniqueFileName(fileName: string, used: Set<string>): string {
  const base = path.basename(fileName, path.extname(fileName));
  const extension = path.extname(fileName).toLowerCase() || ".jpg";
  let candidate = `${base}${extension}`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}${extension}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

