import type { TimelineContext, TimelineSettings } from "@open-node/model";

export type TimelinePlaybackState = TimelineContext["playbackState"];

export interface TimelineEvent {
  context: TimelineContext;
  settings: TimelineSettings;
}

type TimelineListener = (event: TimelineEvent) => void;

export class TimelineRuntime {
  #settings: TimelineSettings;
  #state: TimelinePlaybackState = "stopped";
  #lastTick = 0;
  #timer: ReturnType<typeof setTimeout> | number | undefined;
  #listeners = new Set<TimelineListener>();

  constructor(settings: TimelineSettings) {
    validateTimelineSettings(settings);
    this.#settings = structuredClone(settings);
  }

  get settings(): TimelineSettings {
    return structuredClone(this.#settings);
  }

  get state(): TimelinePlaybackState {
    return this.#state;
  }

  get context(): TimelineContext {
    return {
      timeSeconds: this.#settings.currentTime,
      frame: timeToFrame(this.#settings.currentTime, this.#settings.fps),
      fps: this.#settings.fps,
      deltaTime: 0,
      playbackState: this.#state,
    };
  }

  subscribe(listener: TimelineListener): () => void {
    this.#listeners.add(listener);
    listener({ context: this.context, settings: this.settings });
    return () => this.#listeners.delete(listener);
  }

  configure(patch: Partial<TimelineSettings>): void {
    const next = { ...this.#settings, ...patch };
    validateTimelineSettings(next);
    next.currentTime = clamp(next.currentTime, next.startTime, next.endTime);
    this.#settings = next;
    this.#emit(0);
  }

  setTime(timeSeconds: number, state: TimelinePlaybackState = "scrubbing"): void {
    const previous = this.#settings.currentTime;
    this.#settings.currentTime = clamp(timeSeconds, this.#settings.startTime, this.#settings.endTime);
    const oldState = this.#state;
    this.#state = state;
    this.#emit(this.#settings.currentTime - previous);
    this.#state = oldState;
  }

  setFrame(frame: number, state: TimelinePlaybackState = "scrubbing"): void {
    this.setTime(frameToTime(Math.max(0, Math.round(frame)), this.#settings.fps), state);
  }

  step(frames = 1): void {
    this.setFrame(this.context.frame + frames, "paused");
  }

  play(): void {
    if (!this.#settings.enabled || this.#state === "playing") return;
    this.#state = "playing";
    this.#lastTick = now();
    this.#schedule();
    this.#emit(0);
  }

  pause(): void {
    if (this.#state !== "playing") return;
    this.#cancelTimer();
    this.#state = "paused";
    this.#emit(0);
  }

  stop(): void {
    this.#cancelTimer();
    this.#state = "stopped";
    const delta = this.#settings.startTime - this.#settings.currentTime;
    this.#settings.currentTime = this.#settings.startTime;
    this.#emit(delta);
  }

  destroy(): void {
    this.#cancelTimer();
    this.#listeners.clear();
  }

  async *frames(startFrame = timeToFrame(this.#settings.startTime, this.#settings.fps), endFrame = timeToFrame(this.#settings.endTime, this.#settings.fps), signal?: AbortSignal): AsyncIterable<TimelineContext> {
    const direction = endFrame >= startFrame ? 1 : -1;
    for (let frame = startFrame; direction > 0 ? frame <= endFrame : frame >= endFrame; frame += direction) {
      if (signal?.aborted) throw signal.reason;
      yield {
        timeSeconds: frameToTime(frame, this.#settings.fps),
        frame,
        fps: this.#settings.fps,
        deltaTime: direction / this.#settings.fps,
        playbackState: "scrubbing",
      };
      await Promise.resolve();
    }
  }

  #schedule(): void {
    const tick = () => {
      if (this.#state !== "playing") return;
      const current = now();
      const realDelta = Math.max(0, (current - this.#lastTick) / 1000);
      this.#lastTick = current;
      const delta = realDelta * this.#settings.playbackRate;
      let next = this.#settings.currentTime + delta;
      if (next >= this.#settings.endTime) {
        if (this.#settings.loop) {
          const duration = this.#settings.endTime - this.#settings.startTime;
          next = duration > 0 ? this.#settings.startTime + ((next - this.#settings.startTime) % duration) : this.#settings.startTime;
        } else {
          next = this.#settings.endTime;
          this.#settings.currentTime = next;
          this.#state = "stopped";
          this.#emit(delta);
          return;
        }
      }
      this.#settings.currentTime = next;
      this.#emit(delta);
      this.#schedule();
    };
    if (typeof requestAnimationFrame === "function") this.#timer = requestAnimationFrame(tick);
    else this.#timer = setTimeout(tick, Math.max(4, 1000 / this.#settings.fps));
  }

  #cancelTimer(): void {
    if (this.#timer === undefined) return;
    if (typeof cancelAnimationFrame === "function" && typeof this.#timer === "number") cancelAnimationFrame(this.#timer);
    else clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #emit(deltaTime: number): void {
    const context = { ...this.context, deltaTime };
    const event = { context, settings: this.settings };
    for (const listener of this.#listeners) listener(event);
  }
}

export function timeToFrame(seconds: number, fps: number): number {
  return Math.max(0, Math.round(seconds * fps));
}

export function frameToTime(frame: number, fps: number): number {
  if (fps <= 0) throw new Error("FPS must be positive");
  return frame / fps;
}

export function validateTimelineSettings(settings: TimelineSettings): void {
  if (!Number.isFinite(settings.fps) || settings.fps <= 0 || settings.fps > 1000) throw new Error("Timeline FPS must be between 0 and 1000");
  if (settings.durationSeconds < 0 || settings.endTime < settings.startTime) throw new Error("Timeline range is invalid");
  if (settings.startTime < 0 || settings.endTime > settings.durationSeconds) throw new Error("Timeline range must be within the duration");
  if (!Number.isFinite(settings.playbackRate) || settings.playbackRate <= 0) throw new Error("Timeline playback rate must be positive");
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
