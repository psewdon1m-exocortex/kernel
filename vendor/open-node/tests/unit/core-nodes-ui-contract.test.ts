import { describe, expect, it } from "vitest";
import { coreNodeDefinitions } from "@open-node/core-nodes";

describe("core Node UI contracts", () => {
  it("uses a slash for Divide", () => {
    const divide = coreNodeDefinitions.find((definition) => definition.typeId === "open-node.core.divide");
    expect(divide?.icon).toBe("/");
    expect(divide?.description).toContain("(/)");
  });

  it("gives Universal Import one dynamic result output", () => {
    const universal = coreNodeDefinitions.find((definition) => definition.typeId === "open-node.import.universal");
    expect(universal?.outputs).toEqual([expect.objectContaining({ id: "result", dynamic: true })]);
    expect(universal).toMatchObject({ containerCompatible: true });
    expect(universal?.containerAdapter).toBeTypeOf("function");
  });

  it("allows orange media previews and pink Timeline sources in Containers", () => {
    const definitions = coreNodeDefinitions.filter((definition) => definition.typeId.startsWith("open-node.media.") || definition.typeId.startsWith("open-node.timeline."));
    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition.containerCompatible).toBe(true);
      expect(definition.containerAdapter).toBeTypeOf("function");
    }
  });

  it("allows green Output Nodes in Containers", () => {
    const definitions = coreNodeDefinitions.filter((definition) => definition.typeId.startsWith("open-node.output."));
    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition.containerCompatible).toBe(true);
      expect(definition.containerAdapter).toBeTypeOf("function");
    }
  });

  it("exposes selectable color spaces on the Color Node", () => {
    const color = coreNodeDefinitions.find((definition) => definition.typeId === "open-node.core.color");
    const colorSpace = color?.parameters.find((parameter) => parameter.id === "colorSpace");
    expect(colorSpace?.control).toBe("select");
    expect(colorSpace?.options?.map((option) => option.value)).toEqual(expect.arrayContaining(["srgb", "display-p3", "linear-rgb", "hsl", "oklch"]));
  });
});
