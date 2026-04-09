import path from "node:path";

import { loadImportConfig } from "../config.js";
import { importCatalog, createDefaultCatalogImporter } from "../catalog/importCatalog.js";
import { AIService } from "../ai/aiService.js";

async function main(): Promise<void> {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    throw new Error("Usage: npm run import-catalog -- /absolute/path/to/colors.pdf");
  }

  const config = loadImportConfig(process.cwd());
  const ai = config.geminiApiKey
    ? new AIService({
        visionModel: config.geminiVisionModel,
        imageProvider: "gemini",
        geminiApiKey: config.geminiApiKey,
        geminiVisionModel: config.geminiVisionModel,
        geminiImageModel: process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image-preview",
        timeoutMs: 90_000
      })
    : null;

  const result = await importCatalog(path.resolve(pdfPath), config.catalogPath, createDefaultCatalogImporter(ai));
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
