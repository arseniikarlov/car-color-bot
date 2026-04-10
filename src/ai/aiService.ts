import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  CatalogColor,
  ExtractedVisionCatalog,
  ImageGateway,
  PhotoValidationResult,
  PreviewResult
} from "../types.js";
import { hexToRgb, normalizeHexColor, normalizeRgbColor } from "../catalog/catalogUtils.js";

export interface AIServiceOptions {
  replicateApiToken?: string | null;
  replicateImageModel?: string;
  replicateApiBase?: string;
  timeoutMs: number;
}

export class AIService implements ImageGateway {
  private readonly timeoutMs: number;
  private readonly replicateApiToken: string | null;
  private readonly replicateImageModel: string;
  private readonly replicateApiBase: string;

  constructor(options: AIServiceOptions) {
    this.timeoutMs = options.timeoutMs;
    this.replicateApiToken = options.replicateApiToken?.trim() || null;
    this.replicateImageModel = options.replicateImageModel?.trim() || "black-forest-labs/flux-kontext-pro";
    this.replicateApiBase = normalizeReplicateApiBase(options.replicateApiBase);

    if (!this.replicateApiToken) {
      throw new Error("REPLICATE_API_TOKEN is required");
    }
  }

  async validateCarPhoto(_imagePath: string): Promise<PhotoValidationResult> {
    return {
      is_valid: true,
      reason: "Validation skipped in replicate-only mode.",
      view: "unknown",
      issues: ["validation_skipped_replicate_only"]
    };
  }

  async generatePreview(
    imagePath: string,
    color: CatalogColor,
    catalogReferenceImagePath?: string
  ): Promise<PreviewResult> {
    const canUseCatalogReferenceImage = supportsReplicateMultiImageModel(this.replicateImageModel);
    const shouldUseCatalogReferenceImage = Boolean(catalogReferenceImagePath && canUseCatalogReferenceImage);

    const swatchHex = normalizeHexColor(color.swatch_hex);
    const swatchRgb = normalizeRgbColor(color.swatch_rgb) ?? hexToRgb(swatchHex);
    const swatchHint =
      swatchHex || swatchRgb
        ? `Target paint shade from the catalog swatch: ${formatSwatchHint(swatchHex, swatchRgb)}. Match this tone closely while preserving natural reflections and lighting.`
        : null;

    const prompt = [
      "Замени цвет машины на цвет с каталога.",
      shouldUseCatalogReferenceImage
        ? "2 файла: 1) машина от клиента, 2) цвет из каталога."
        : "Ориентируйся на код, название и оттенок цвета из каталога.",
      `Целевой цвет: код ${color.code}, название ${color.name}.`,
      "Режим стабильности: минимальная креативность, без стилизации и без редизайна сцены.",
      "Сохрани исходное кадрирование целиком, без обрезки.",
      ...(swatchHint ? [swatchHint] : []),
      "Strict rules:",
      "- Recolor only painted exterior body panels.",
      "- Keep the same car identity and all original visual details.",
      "- Do NOT modify camera angle, framing, perspective, or composition.",
      "- Do NOT modify background, road, sky, people, buildings, or any non-car objects.",
      "- Do NOT modify wheels, tires, windows, mirrors, lights, grille, badges, plate, trim, shadows, reflections, or body geometry.",
      "- Keep realism and original texture; only hue/saturation/value of body paint may change.",
      "If uncertain, preserve original pixels and avoid any non-color edits.",
      "Output must look identical to the original photo except for body paint color."
    ].join(" ");

    const response = await this.editImageViaReplicateEndpoint(imagePath, prompt, catalogReferenceImagePath);

    const base64 = response.data?.[0]?.b64_json;
    if (!base64) {
      throw new Error("Image edit returned an empty result");
    }

    const outputPath = path.join(path.dirname(imagePath), `preview-${Date.now()}.png`);
    await writeFile(outputPath, Buffer.from(base64, "base64"));

    return {
      output_image_path: outputPath,
      prompt_version: "v4-stable-color-only",
      model: this.replicateImageModel
    };
  }

  private async editImageViaReplicateEndpoint(
    imagePath: string,
    prompt: string,
    catalogReferenceImagePath?: string
  ): Promise<{ data?: Array<{ b64_json?: string }> }> {
    if (!this.replicateApiToken) {
      throw new Error("REPLICATE_API_TOKEN is not configured");
    }

    const model = parseReplicateModel(this.replicateImageModel);
    const input: Record<string, unknown> = {
      prompt,
      aspect_ratio: "match_input_image"
    };

    if (catalogReferenceImagePath && supportsReplicateMultiImageModel(this.replicateImageModel)) {
      const inputImages: string[] = [await this.uploadReplicateFile(imagePath)];
      try {
        inputImages.push(await this.uploadReplicateFile(catalogReferenceImagePath));
      } catch {
        // Continue with only client image if the catalog reference image is unavailable.
      }
      if (inputImages.length > 1) {
        input.input_images = inputImages;
      } else {
        input.input_image = inputImages[0];
      }
    } else {
      input.input_image = await this.uploadReplicateFile(imagePath);
    }

    const waitSeconds = Math.max(1, Math.min(60, Math.ceil(this.timeoutMs / 1000)));
    const endpoint = model.version
      ? `${this.replicateApiBase}/predictions`
      : `${this.replicateApiBase}/models/${encodeURIComponent(model.owner)}/${encodeURIComponent(model.name)}/predictions`;
    const requestBody = model.version ? { version: model.version, input } : { input };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.replicateApiToken}`,
        "Content-Type": "application/json",
        Prefer: `wait=${waitSeconds}`
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    const prediction = (await response.json().catch(() => null)) as
      | {
          id?: string;
          status?: string;
          output?: unknown;
          error?: unknown;
          detail?: unknown;
        }
      | null;

    if (!response.ok) {
      throw new Error(extractReplicateApiError(prediction, response.status));
    }

    const resolvedPrediction = await this.waitForReplicatePrediction(prediction);
    if (resolvedPrediction.status === "failed") {
      throw new Error(formatReplicateError(resolvedPrediction.error) || "Replicate prediction failed");
    }
    if (resolvedPrediction.status !== "succeeded") {
      throw new Error(`Replicate prediction did not complete successfully (status: ${resolvedPrediction.status})`);
    }

    const outputBuffer = await replicateOutputToBuffer(resolvedPrediction.output, this.timeoutMs);
    if (!outputBuffer) {
      throw new Error("Replicate image edit returned an empty result");
    }

    return {
      data: [{ b64_json: outputBuffer.toString("base64") }]
    };
  }

  private async uploadReplicateFile(filePath: string): Promise<string> {
    if (!this.replicateApiToken) {
      throw new Error("REPLICATE_API_TOKEN is not configured");
    }

    const bytes = await readFile(filePath);
    const form = new FormData();
    const fileBlob = new Blob([bytes], { type: detectMimeType(filePath) });
    form.append("content", fileBlob, path.basename(filePath) || `image-${Date.now()}.jpg`);
    form.append("metadata", new Blob([JSON.stringify({ source: "car-color-bot" })], { type: "application/json" }));

    const response = await fetch(`${this.replicateApiBase}/files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.replicateApiToken}`
      },
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          urls?: {
            get?: string;
          };
          error?: unknown;
          detail?: unknown;
        }
      | null;

    if (!response.ok) {
      throw new Error(extractReplicateApiError(payload, response.status));
    }

    const fileUrl = payload?.urls?.get;
    if (!fileUrl) {
      throw new Error("Replicate file upload returned an empty file URL");
    }
    return fileUrl;
  }

  private async waitForReplicatePrediction(prediction: {
    id?: string;
    status?: string;
    output?: unknown;
    error?: unknown;
  } | null): Promise<{ status: string; output?: unknown; error?: unknown }> {
    if (!prediction) {
      throw new Error("Replicate returned an empty prediction object");
    }

    const initialStatus = prediction.status?.toLowerCase() ?? "unknown";
    if (initialStatus === "succeeded" || initialStatus === "failed" || initialStatus === "canceled") {
      return {
        status: initialStatus,
        output: prediction.output,
        error: prediction.error
      };
    }

    if (!prediction.id) {
      throw new Error("Replicate prediction id is missing");
    }

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      await sleep(1_000);
      const response = await fetch(`${this.replicateApiBase}/predictions/${encodeURIComponent(prediction.id)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.replicateApiToken}`
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            status?: string;
            output?: unknown;
            error?: unknown;
            detail?: unknown;
          }
        | null;

      if (!response.ok) {
        throw new Error(extractReplicateApiError(payload, response.status));
      }

      const status = payload?.status?.toLowerCase() ?? "unknown";
      if (status === "succeeded" || status === "failed" || status === "canceled") {
        return {
          status,
          output: payload?.output,
          error: payload?.error
        };
      }
    }

    throw new Error("Replicate prediction timed out");
  }

  async extractCatalogColorsFromImage(imagePath: string): Promise<ExtractedVisionCatalog> {
    void imagePath;
    throw new Error("Catalog vision extraction is disabled in replicate-only mode.");
  }
}

function formatSwatchHint(
  swatchHex: string | null,
  swatchRgb: { r: number; g: number; b: number } | null
): string {
  const rgbText = swatchRgb ? `RGB(${swatchRgb.r}, ${swatchRgb.g}, ${swatchRgb.b})` : null;
  if (swatchHex && rgbText) {
    return `${swatchHex}, ${rgbText}`;
  }
  if (swatchHex) {
    return swatchHex;
  }
  if (rgbText) {
    return rgbText;
  }
  return "unknown";
}

function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
}

function normalizeReplicateApiBase(raw: string | undefined): string {
  const base = raw?.trim() || "https://api.replicate.com/v1";
  return base.replace(/\/+$/u, "");
}

function supportsReplicateMultiImageModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized.includes("multi-image") ||
    normalized.includes("multi_image") ||
    normalized.includes("multiimage")
  );
}

function parseReplicateModel(model: string): { owner: string; name: string; version?: string } {
  const trimmed = model.trim();
  const [ownerAndNameRaw, versionRaw] = trimmed.split(":");
  if (!ownerAndNameRaw) {
    throw new Error(`Invalid REPLICATE_IMAGE_MODEL: ${model}. Use owner/name or owner/name:version`);
  }
  const [owner, name] = ownerAndNameRaw.split("/");
  const version = versionRaw?.trim();

  if (!owner || !name) {
    throw new Error(`Invalid REPLICATE_IMAGE_MODEL: ${model}. Use owner/name or owner/name:version`);
  }

  return {
    owner,
    name,
    ...(version ? { version } : {})
  };
}

async function replicateOutputToBuffer(output: unknown, timeoutMs: number): Promise<Buffer | null> {
  if (!output) {
    return null;
  }

  if (Array.isArray(output)) {
    for (const item of output) {
      const buffer = await replicateOutputToBuffer(item, timeoutMs);
      if (buffer) {
        return buffer;
      }
    }
    return null;
  }

  if (typeof output === "string") {
    return downloadBufferFromUrl(output, timeoutMs);
  }

  if (output instanceof URL) {
    return downloadBufferFromUrl(output.toString(), timeoutMs);
  }

  if (isReplicateFileOutput(output)) {
    const blob = await output.blob();
    const bytes = await blob.arrayBuffer();
    return Buffer.from(bytes);
  }

  if (typeof output === "object" && output !== null) {
    const outputWithUrl = output as { url?: unknown };
    if (typeof outputWithUrl.url === "string") {
      return downloadBufferFromUrl(outputWithUrl.url, timeoutMs);
    }
    if (typeof outputWithUrl.url === "function") {
      const urlValue = outputWithUrl.url();
      if (urlValue instanceof URL) {
        return downloadBufferFromUrl(urlValue.toString(), timeoutMs);
      }
      if (typeof urlValue === "string") {
        return downloadBufferFromUrl(urlValue, timeoutMs);
      }
    }
  }

  return null;
}

async function downloadBufferFromUrl(url: string, timeoutMs: number): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Failed to download Replicate output: ${response.status}`);
  }

  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
}

function isReplicateFileOutput(value: unknown): value is { blob: () => Promise<Blob> } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { blob?: unknown }).blob === "function"
  );
}

function extractReplicateApiError(payload: unknown, status: number): string {
  const formatted = formatReplicateError(payload);
  return formatted || `Replicate request failed with status ${status}`;
}

function formatReplicateError(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const message = formatReplicateError(item);
      if (message) {
        return message;
      }
    }
    return null;
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const directKeys = ["detail", "error", "message", "title", "reason"] as const;
    for (const key of directKeys) {
      const message = formatReplicateError(objectValue[key]);
      if (message) {
        return message;
      }
    }
  }

  return null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
