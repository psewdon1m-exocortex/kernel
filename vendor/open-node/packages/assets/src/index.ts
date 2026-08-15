import { createId, type AssetReference, type AssetStorageMode } from "@open-node/model";

export interface ImportableFile {
  name: string;
  type?: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface DetectedAssetType {
  mimeType: string;
  mediaType: AssetReference["mediaType"];
  extension: string;
  confidence: "signature" | "mime" | "content" | "extension" | "fallback";
}

export interface AssetImportOptions {
  storage?: AssetStorageMode;
  uri?: string;
  path?: string;
  maxBytes?: number;
  includeChecksum?: boolean;
}

export interface ImportedAsset {
  reference: AssetReference;
  bytes?: Uint8Array;
  preview?: { kind: "image" | "video" | "audio" | "text"; value: string };
}

export interface AssetResolver {
  resolve(asset: AssetReference, signal?: AbortSignal): Promise<Uint8Array | null>;
}

export interface TypeProbe {
  id: string;
  probe(file: ImportableFile, head: Uint8Array): Promise<DetectedAssetType | null> | DetectedAssetType | null;
}

const MIME_MAP: Record<string, Omit<DetectedAssetType, "confidence">> = {
  "image/png": { mimeType: "image/png", mediaType: "image", extension: "png" },
  "image/jpeg": { mimeType: "image/jpeg", mediaType: "image", extension: "jpg" },
  "image/webp": { mimeType: "image/webp", mediaType: "image", extension: "webp" },
  "image/gif": { mimeType: "image/gif", mediaType: "image", extension: "gif" },
  "image/svg+xml": { mimeType: "image/svg+xml", mediaType: "image", extension: "svg" },
  "image/bmp": { mimeType: "image/bmp", mediaType: "image", extension: "bmp" },
  "image/tiff": { mimeType: "image/tiff", mediaType: "image", extension: "tiff" },
  "video/mp4": { mimeType: "video/mp4", mediaType: "video", extension: "mp4" },
  "video/webm": { mimeType: "video/webm", mediaType: "video", extension: "webm" },
  "video/quicktime": { mimeType: "video/quicktime", mediaType: "video", extension: "mov" },
  "audio/wav": { mimeType: "audio/wav", mediaType: "audio", extension: "wav" },
  "audio/mpeg": { mimeType: "audio/mpeg", mediaType: "audio", extension: "mp3" },
  "audio/ogg": { mimeType: "audio/ogg", mediaType: "audio", extension: "ogg" },
  "audio/flac": { mimeType: "audio/flac", mediaType: "audio", extension: "flac" },
  "application/json": { mimeType: "application/json", mediaType: "text", extension: "json" },
  "text/csv": { mimeType: "text/csv", mediaType: "table", extension: "csv" },
  "text/tab-separated-values": { mimeType: "text/tab-separated-values", mediaType: "table", extension: "tsv" },
  "text/plain": { mimeType: "text/plain", mediaType: "text", extension: "txt" },
  "text/markdown": { mimeType: "text/markdown", mediaType: "text", extension: "md" },
  "application/xml": { mimeType: "application/xml", mediaType: "text", extension: "xml" },
  "application/pdf": { mimeType: "application/pdf", mediaType: "document", extension: "pdf" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", mediaType: "document", extension: "docx" },
  "application/vnd.open-node.project+json": { mimeType: "application/vnd.open-node.project+json", mediaType: "document", extension: "onode.json" },
  "model/gltf+json": { mimeType: "model/gltf+json", mediaType: "geometry", extension: "gltf" },
  "model/gltf-binary": { mimeType: "model/gltf-binary", mediaType: "geometry", extension: "glb" },
  "application/zip": { mimeType: "application/zip", mediaType: "archive", extension: "zip" },
  "application/octet-stream": { mimeType: "application/octet-stream", mediaType: "binary", extension: "bin" },
};

const EXTENSION_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
  wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac", m4a: "audio/mp4",
  json: "application/json", yaml: "application/yaml", yml: "application/yaml", csv: "text/csv", tsv: "text/tab-separated-values", txt: "text/plain", md: "text/markdown", xml: "application/xml",
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", onode: "application/vnd.open-node.project+json", gltf: "model/gltf+json", glb: "model/gltf-binary", obj: "model/obj", stl: "model/stl", ply: "model/ply", zip: "application/zip",
};

export class AssetRegistry {
  #assets = new Map<string, AssetReference>();
  #probes: TypeProbe[] = [];
  #resolvers = new Map<AssetStorageMode, AssetResolver>();

  register(reference: AssetReference): void {
    if (this.#assets.has(reference.id)) throw new Error(`Asset already registered: ${reference.id}`);
    this.#assets.set(reference.id, structuredClone(reference));
  }

  upsert(reference: AssetReference): void {
    this.#assets.set(reference.id, structuredClone(reference));
  }

  get(id: string): AssetReference | undefined {
    const asset = this.#assets.get(id);
    return asset ? structuredClone(asset) : undefined;
  }

  list(): AssetReference[] {
    return [...this.#assets.values()].map((asset) => structuredClone(asset));
  }

  remove(id: string): void {
    this.#assets.delete(id);
  }

  registerProbe(probe: TypeProbe): void {
    if (this.#probes.some((current) => current.id === probe.id)) throw new Error(`Asset probe already registered: ${probe.id}`);
    this.#probes.push(probe);
  }

  registerResolver(mode: AssetStorageMode, resolver: AssetResolver): void {
    this.#resolvers.set(mode, resolver);
  }

  async detect(file: ImportableFile): Promise<DetectedAssetType> {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const head = buffer.subarray(0, Math.min(4096, buffer.length));
    const signature = detectSignature(head);
    if (signature) return signature;
    for (const probe of this.#probes) {
      const result = await probe.probe(file, head);
      if (result) return result;
    }
    const content = detectTextContent(head, file.name);
    if (content) return content;
    const declaredMime = file.type?.toLowerCase().split(";")[0];
    if (declaredMime && declaredMime !== "application/octet-stream") {
      const known = MIME_MAP[declaredMime];
      if (known) return { ...known, confidence: "mime" };
    }
    const extension = extensionOf(file.name);
    const mime = EXTENSION_MIME[extension];
    if (mime) return { ...(MIME_MAP[mime] ?? describeUnknownMime(mime, extension)), confidence: "extension" };
    return { ...MIME_MAP["application/octet-stream"]!, extension: extension || "bin", confidence: "fallback" };
  }

  async import(file: ImportableFile, options: AssetImportOptions = {}): Promise<ImportedAsset> {
    const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
    if (file.size > maxBytes) throw new Error(`Asset exceeds maximum size of ${maxBytes} bytes`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size && file.size !== 0) throw new Error("Asset size changed while importing");
    // Browser File fields live on the prototype and are lost by object spread.
    // Copy the import contract explicitly so detection sees the real name/MIME.
    const type = await this.detect({
      name: file.name,
      type: file.type,
      size: file.size,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    if (type.mimeType === "image/svg+xml") sanitizeSvg(new TextDecoder().decode(bytes));
    const storage = options.storage ?? "embedded";
    const detectedMetadata = extractMetadata(type, bytes);
    const reference: AssetReference = {
      id: createId("asset"),
      name: file.name,
      storage,
      ...(options.uri ? { uri: options.uri } : {}),
      ...(options.path ? { path: options.path } : {}),
      mimeType: type.mimeType,
      mediaType: type.mediaType,
      size: bytes.byteLength,
      ...(options.includeChecksum === false ? {} : { checksum: await sha256(bytes) }),
      metadata: { extension: type.extension, detectionConfidence: type.confidence, ...detectedMetadata },
      ...(storage === "embedded" ? { embeddedPath: `assets/${createSafeFilename(file.name)}` } : {}),
    };
    this.upsert(reference);
    const result: ImportedAsset = { reference };
    if (storage === "embedded") result.bytes = bytes;
    const preview = createPreview(type, bytes);
    if (preview) result.preview = preview;
    return result;
  }

  async resolve(id: string, signal?: AbortSignal): Promise<Uint8Array | null> {
    const asset = this.#assets.get(id);
    if (!asset) throw new Error(`Asset not found: ${id}`);
    const resolver = this.#resolvers.get(asset.storage);
    if (!resolver) return null;
    const bytes = await resolver.resolve(asset, signal);
    if (!bytes) {
      this.#assets.set(id, { ...asset, missing: true });
      return null;
    }
    this.#assets.set(id, { ...asset, missing: false });
    return bytes;
  }
}

export function detectSignature(bytes: Uint8Array): DetectedAssetType | null {
  const ascii = (start: number, length: number) => new TextDecoder("ascii").decode(bytes.subarray(start, start + length));
  const match = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (match(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return detected("image/png", "image", "png");
  if (match(0xff, 0xd8, 0xff)) return detected("image/jpeg", "image", "jpg");
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return detected("image/gif", "image", "gif");
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return detected("image/webp", "image", "webp");
  if (ascii(0, 2) === "BM") return detected("image/bmp", "image", "bmp");
  if (match(0x49, 0x49, 0x2a, 0x00) || match(0x4d, 0x4d, 0x00, 0x2a)) return detected("image/tiff", "image", "tiff");
  if (ascii(0, 5) === "%PDF-") return detected("application/pdf", "document", "pdf");
  if (match(0x50, 0x4b, 0x03, 0x04) || match(0x50, 0x4b, 0x05, 0x06)) return detected("application/zip", "archive", "zip");
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (["qt  "].includes(brand)) return detected("video/quicktime", "video", "mov");
    return detected("video/mp4", "video", "mp4");
  }
  if (match(0x1a, 0x45, 0xdf, 0xa3)) return detected("video/webm", "video", "webm");
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return detected("audio/wav", "audio", "wav");
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return detected("audio/mpeg", "audio", "mp3");
  if (ascii(0, 4) === "OggS") return detected("audio/ogg", "audio", "ogg");
  if (ascii(0, 4) === "fLaC") return detected("audio/flac", "audio", "flac");
  if (ascii(0, 4) === "glTF") return detected("model/gltf-binary", "geometry", "glb");
  return null;
}

export function sanitizeSvg(svg: string): string {
  if (/<script\b/i.test(svg) || /\son[a-z]+\s*=/i.test(svg) || /(?:href|src)\s*=\s*["']\s*(?:javascript:|data:text\/html)/i.test(svg) || /<foreignObject\b/i.test(svg)) {
    throw new Error("Unsafe SVG content rejected");
  }
  return svg;
}

function detectTextContent(bytes: Uint8Array, name: string): DetectedAssetType | null {
  if (bytes.length === 0) return null;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trimStart();
  if (text.includes("�") || /[\u0000-\u0008\u000E-\u001F]/.test(text)) return null;
  if (/^<svg(?:\s|>)/i.test(text)) return { mimeType: "image/svg+xml", mediaType: "image", extension: "svg", confidence: "content" };
  if (/^[\[{]/.test(text)) {
    try {
      JSON.parse(text);
      const gltf = text.startsWith("{") && /["']asset["']\s*:/.test(text) && /["']version["']\s*:/.test(text);
      return { mimeType: gltf ? "model/gltf+json" : "application/json", mediaType: gltf ? "geometry" : "text", extension: gltf ? "gltf" : "json", confidence: "content" };
    } catch {
      // Continue with generic text detection.
    }
  }
  const extension = extensionOf(name);
  if (extension === "csv" || (text.split("\n")[0]?.split(",").length ?? 0) > 2) return { mimeType: "text/csv", mediaType: "table", extension: "csv", confidence: "content" };
  if (extension === "tsv" || (text.split("\n")[0]?.split("\t").length ?? 0) > 2) return { mimeType: "text/tab-separated-values", mediaType: "table", extension: "tsv", confidence: "content" };
  if (text.length > 0) return { mimeType: EXTENSION_MIME[extension] ?? "text/plain", mediaType: "text", extension: extension || "txt", confidence: "content" };
  return null;
}

function createPreview(type: DetectedAssetType, bytes: Uint8Array): ImportedAsset["preview"] | undefined {
  if (type.mediaType === "text" || type.mediaType === "table") return { kind: "text", value: new TextDecoder().decode(bytes.subarray(0, 2048)) };
  if (typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return undefined;
  if (["image", "video", "audio"].includes(type.mediaType)) {
    const value = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: type.mimeType }));
    return { kind: type.mediaType as "image" | "video" | "audio", value };
  }
  return undefined;
}

function extractMetadata(type: DetectedAssetType, bytes: Uint8Array): Record<string, unknown> {
  if (type.mediaType !== "text" && type.mediaType !== "table") return {};
  const text = new TextDecoder().decode(bytes);
  if (type.mimeType === "application/json") {
    try { return { text: text.slice(0, 65_536), json: JSON.parse(text) }; } catch { return { text: text.slice(0, 65_536) }; }
  }
  if (type.mediaType === "table") {
    const delimiter = type.mimeType === "text/tab-separated-values" ? "\t" : ",";
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headers = lines[0]?.split(delimiter).map((value) => value.trim()) ?? [];
    const rows = lines.slice(1, 101).map((line) => Object.fromEntries(headers.map((header, index) => [header, line.split(delimiter)[index]?.trim() ?? ""])));
    return { text: text.slice(0, 65_536), columns: headers, rows };
  }
  return { text: text.slice(0, 65_536) };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) return "unavailable";
  const copy = new Uint8Array(bytes).buffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function detected(mimeType: string, mediaType: AssetReference["mediaType"], extension: string): DetectedAssetType {
  return { mimeType, mediaType, extension, confidence: "signature" };
}

function extensionOf(name: string): string {
  const match = /\.([^.]+)$/.exec(name.toLowerCase());
  return match?.[1] ?? "";
}

function describeUnknownMime(mimeType: string, extension: string): Omit<DetectedAssetType, "confidence"> {
  const top = mimeType.split("/")[0];
  const mediaType = top === "image" || top === "video" || top === "audio" ? top : top === "text" ? "text" : top === "model" ? "geometry" : "binary";
  return { mimeType, mediaType, extension } as Omit<DetectedAssetType, "confidence">;
}

function createSafeFilename(name: string): string {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 180) || "asset.bin";
}
