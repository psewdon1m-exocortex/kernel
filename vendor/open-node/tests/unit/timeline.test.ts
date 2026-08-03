import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@open-node/model";
import { frameToTime, TimelineRuntime, timeToFrame } from "@open-node/timeline";

describe("TimelineRuntime", () => {
  it("converts time and frame deterministically", () => {
    expect(timeToFrame(4, 30)).toBe(120);
    expect(frameToTime(120, 30)).toBe(4);
  });

  it("supports scrub, step and stop", () => {
    const settings = createEmptyProject().timeline;
    settings.enabled = true;
    const timeline = new TimelineRuntime(settings);
    timeline.setFrame(120);
    expect(timeline.context.timeSeconds).toBe(4);
    timeline.step(1);
    expect(timeline.context.frame).toBe(121);
    timeline.stop();
    expect(timeline.context.frame).toBe(0);
  });

  it("iterates an offline frame range", async () => {
    const timeline = new TimelineRuntime({ ...createEmptyProject().timeline, enabled: true });
    const frames: number[] = [];
    for await (const context of timeline.frames(2, 4)) frames.push(context.frame);
    expect(frames).toEqual([2, 3, 4]);
  });
});
