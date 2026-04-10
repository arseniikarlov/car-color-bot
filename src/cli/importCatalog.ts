import path from "node:path";
import { stat } from "node:fs/promises";

import { loadImportConfig } from "../config.js";
import { importCatalog, createDefaultCatalogImporter } from "../catalog/importCatalog.js";
import { importImageCatalog } from "../catalog/importImageCatalog.js";

async function main(): Promise<void> {
  const sourcePathRaw = process.argv[2];
  if (!sourcePathRaw) {
    throw new Error("Usage: npm run import-catalog -- /absolute/path/to/colors.pdf|/absolute/path/to/images_dir");
  }
  const sourcePath = path.resolve(sourcePathRaw);
  const sourceStats = await stat(sourcePath).catch(() => null);
  if (!sourceStats) {
    throw new Error(`Source path does not exist: ${sourcePath}`);
  }

  const config = loadImportConfig(process.cwd());
  const result = sourceStats.isDirectory()
    ? await importImageCatalog(sourcePath, config.catalogPath)
    : await importCatalog(
        sourcePath,
        config.catalogPath,
        createDefaultCatalogImporter(null)
      );
  console.log(
    JSON.stringify(
      {
        source_pdf: result.source_pdf,
        generated_at: result.generated_at,
        imported_colors: result.items.length,
        warnings: result.warnings
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
