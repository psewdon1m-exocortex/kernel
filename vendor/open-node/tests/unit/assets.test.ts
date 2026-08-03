import { describe, expect, it } from "vitest";
import { AssetRegistry, detectSignature, sanitizeSvg } from "@open-node/assets";

describe("AssetRegistry", () => {
  it("detects content by magic bytes before misleading extension", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const registry = new AssetRegistry();
    const detected = await registry.detect(file("wrong.txt", png, "text/plain"));
    expect(detected).toMatchObject({ mimeType: "image/png", confidence: "signature" });
    expect(detectSignature(png)?.mediaType).toBe("image");
  });

  it("imports an embedded asset with a checksum", async () => {
    const bytes = new TextEncoder().encode('{"hello":"world"}');
    const imported = await new AssetRegistry().import(file("data.json", bytes, "application/json"));
    expect(imported.reference).toMatchObject({ mediaType: "text", storage: "embedded", size: bytes.length });
    expect(imported.reference.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects executable SVG content", () => {
    expect(() => sanitizeSvg('<svg><script>alert(1)</script></svg>')).toThrow(/Unsafe SVG/);
  });
});

function file(name: string, bytes: Uint8Array, type = ""): { name: string; size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> } {
  return { name, size: bytes.byteLength, type, arrayBuffer: async () => new Uint8Array(bytes).buffer };
}
