import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";

import type {
  CatalogColor,
  ExtractedVisionCatalog,
  OpenAIImageGateway,
  PhotoValidationResult,
  PreviewResult
} from "../types.js";
import { hexToRgb, normalizeHexColor, normalizeRgbColor } from "../catalog/catalogUtils.js";

export interface OpenAIServiceOptions {
  apiKey: string;
  visionModel: string;
  imageModel: string;
  imageProvider?: "openai" | "gemini" | "replicate";
  geminiApiKey?: string | null;
  geminiImageModel?: string;
  geminiApiBase?: string;
  replicateApiToken?: string | null;
  replicateImageModel?: string;
  replicateApiBase?: string;
  timeoutMs: number;
}

export class OpenAIService implements OpenAIImageGateway {
  private readonly client: OpenAI;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly visionModel: string;
  private readonly imageModel: string;
  private readonly imageProvider: "openai" | "gemini" | "replicate";
  private readonly geminiApiKey: string | null;
  private readonly geminiImageModel: string;
  private readonly geminiApiBase: string;
  private readonly replicateApiToken: string | null;
  private readonly replicateImageModel: string;
  private readonly replicateApiBase: string;

  constructor(options: OpenAIServiceOptions) {
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
    this.visionModel = options.visionModel;
    this.imageModel = options.imageModel;
    this.imageProvider = options.imageProvider ?? "openai";
    this.geminiApiKey = options.geminiApiKey?.trim() || null;
    this.geminiImageModel = options.geminiImageModel?.trim() || "gemini-3.1-flash-image-preview";
    this.geminiApiBase = normalizeApiBase(options.geminiApiBase);
    this.replicateApiToken = options.replicateApiToken?.trim() || null;
    this.replicateImageModel = options.replicateImageModel?.trim() || "black-forest-labs/flux-kontext-pro";
    this.replicateApiBase = normalizeReplicateApiBase(options.replicateApiBase);
    this.client = new OpenAI({
      apiKey: options.apiKey,
      timeout: options.timeoutMs
    });

    if (this.imageProvider === "gemini" && !this.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is required when IMAGE_PROVIDER=gemini");
    }
    if (this.imageProvider === "replicate" && !this.replicateApiToken) {
      throw new Error("REPLICATE_API_TOKEN is required when IMAGE_PROVIDER=replicate");
    }
  }

  async validateCarPhoto(imagePath: string): Promise<PhotoValidationResult> {
    const dataUrl = await fileToDataUrl(imagePath);
    const completion = await this.client.chat.completions.create({
      model: this.visionModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You validate user photos for a car repaint preview bot. Respond with JSON only: " +
            '{"is_valid":boolean,"reason":string,"view":string,"issues":string[]}. ' +
            "A valid photo must contain one car, visible body panels, acceptable lighting, and minimal occlusion."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Validate this car photo. Reject if there are multiple cars, too little body visible, very dark lighting, heavy blur, or strong occlusion."
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl
              }
            }
          ]
        }
      ]
    });

    const parsed = safeJsonParse<PhotoValidationResult>(completion.choices[0]?.message?.content);
    if (!parsed) {
      throw new Error("OpenAI validation returned invalid JSON");
    }

    return {
      is_valid: Boolean(parsed.is_valid),
      reason: parsed.reason?.trim() || "Unable to validate the image",
      view: parsed.view?.trim() || "unknown",
      issues: Array.isArray(parsed.issues) ? parsed.issues.map((item) => String(item)) : []
    };
  }

  async generatePreview(
    imagePath: string,
    color: CatalogColor,
    catalogReferenceImagePath?: string
  ): Promise<PreviewResult> {
    const canUseCatalogReferenceImage =
      this.imageProvider !== "replicate" || supportsReplicateMultiImageModel(this.replicateImageModel);
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

    const response =
      this.imageProvider === "gemini"
        ? await this.editImageViaGeminiEndpoint(imagePath, prompt, catalogReferenceImagePath)
        : this.imageProvider === "replicate"
          ? await this.editImageViaReplicateEndpoint(imagePath, prompt, catalogReferenceImagePath)
          : isGptImageModel(this.imageModel)
            ? await this.editImageViaJsonEndpoint(imagePath, prompt, catalogReferenceImagePath)
            : await this.client.images.edit({
                model: this.imageModel,
                image: createReadStream(imagePath) as any,
                prompt,
                size: "auto"
              } as any);

    const base64 = response.data?.[0]?.b64_json;
    if (!base64) {
      throw new Error("Image edit returned an empty result");
    }

    const outputPath = path.join(path.dirname(imagePath), `preview-${Date.now()}.png`);
    await writeFile(outputPath, Buffer.from(base64, "base64"));

    return {
      output_image_path: outputPath,
      prompt_version: "v4-stable-color-only",
      model:
        this.imageProvider === "gemini"
          ? this.geminiImageModel
          : this.imageProvider === "replicate"
            ? this.replicateImageModel
            : this.imageModel
    };
  }

  private async editImageViaJsonEndpoint(
    imagePath: string,
    prompt: string,
    catalogReferenceImagePath?: string
  ): Promise<{ data?: Array<{ b64_json?: string }> }> {
    const imageDataUrl = await fileToDataUrl(imagePath);
    const images: Array<{ image_url: string }> = [{ image_url: imageDataUrl }];
    if (catalogReferenceImagePath) {
      try {
        const catalogColorDataUrl = await fileToDataUrl(catalogReferenceImagePath);
        images.push({ image_url: catalogColorDataUrl });
      } catch {
        // Continue with the main client image if catalog reference image is unavailable.
      }
    }

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.imageModel,
        images,
        prompt,
        size: "auto",
        output_format: "png"
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    const json = (await response.json().catch(() => null)) as
      | { data?: Array<{ b64_json?: string }>; error?: { message?: string } }
      | null;
    if (!response.ok) {
      const errorMessage = json?.error?.message || `OpenAI image edit failed with status ${response.status}`;
      throw new Error(errorMessage);
    }

    return json?.data ? { data: json.data } : {};
  }

  private async editImageViaGeminiEndpoint(
    imagePath: string,
    prompt: string,
    catalogReferenceImagePath?: string
  ): Promise<{ data?: Array<{ b64_json?: string }> }> {
    const parts: Array<
      | { text: string }
      | {
          inline_data: {
            mime_type: string;
            data: string;
          };
        }
    > = [];

    const carImage = await fileToInlineData(imagePath);
    parts.push({ inline_data: carImage });

    if (catalogReferenceImagePath) {
      try {
        const refImage = await fileToInlineData(catalogReferenceImagePath);
        parts.push({ inline_data: refImage });
      } catch {
        // Keep edit flow working even if reference image cannot be read.
      }
    }

    parts.push({ text: prompt });

    const endpoint =
      `${this.geminiApiBase}/models/${encodeURIComponent(this.geminiImageModel)}:generateContent` +
      `?key=${encodeURIComponent(this.geminiApiKey ?? "")}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ["IMAGE"]
        }
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    const json = (await response.json().catch(() => null)) as
      | {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                inline_data?: { data?: string };
                inlineData?: { data?: string };
              }>;
            };
          }>;
          error?: { message?: string };
        }
      | null;

    if (!response.ok) {
      const errorMessage = json?.error?.message || `Gemini image edit failed with status ${response.status}`;
      throw new Error(errorMessage);
    }

    const resultParts = json?.candidates?.[0]?.content?.parts ?? [];
    for (const part of resultParts) {
      const imageBase64 = part.inlineData?.data ?? part.inline_data?.data;
      if (imageBase64) {
        return { data: [{ b64_json: imageBase64 }] };
      }
    }

    throw new Error("Gemini image edit returned an empty result");
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
    const dataUrl = await fileToDataUrl(imagePath);
    const completion = await this.client.chat.completions.create({
      model: this.visionModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract paint catalog entries from a catalog page image. Return JSON only with shape " +
            '{"brand":string,"series":string,"items":[{"code":string,"name":string,"swatch_hex":string,"swatch_rgb":{"r":number,"g":number,"b":number}}]}. ' +
            "For each row, read the corresponding color swatch and provide its closest swatch_hex and swatch_rgb. " +
            "Do not hallucinate codes or names."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Read this catalog page and extract each visible color entry. Infer brand and series from the page heading if possible. " +
                "For each extracted color, estimate the swatch color from the page and return hex/rgb."
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl
              }
            }
          ]
        }
      ]
    });

    const parsed = safeJsonParse<ExtractedVisionCatalog>(completion.choices[0]?.message?.content);
    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error("OpenAI catalog extraction returned invalid JSON");
    }

    return {
      brand: parsed.brand?.trim() ?? "",
      series: parsed.series?.trim() ?? "",
      items: parsed.items.map((item) => {
        const swatchHex = normalizeHexColor(item.swatch_hex);
        const swatchRgb = normalizeRgbColor(item.swatch_rgb);
        return {
          code: String(item.code ?? "").trim(),
          name: String(item.name ?? "").trim(),
          ...(swatchHex ? { swatch_hex: swatchHex } : {}),
          ...(swatchRgb ? { swatch_rgb: swatchRgb } : {})
        };
      })
    };
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

function isGptImageModel(model: string): boolean {
  return model.startsWith("gpt-image-") || model === "chatgpt-image-latest";
}

async function fileToDataUrl(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const mimeType = detectMimeType(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function fileToInlineData(filePath: string): Promise<{ mime_type: string; data: string }> {
  const buffer = await readFile(filePath);
  return {
    mime_type: detectMimeType(filePath),
    data: buffer.toString("base64")
  };
}

function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
}

function normalizeApiBase(raw: string | undefined): string {
  const base = raw?.trim() || "https://generativelanguage.googleapis.com/v1beta";
  return base.replace(/\/+$/u, "");
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

function safeJsonParse<T>(content: string | null | undefined): T | null {
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}
