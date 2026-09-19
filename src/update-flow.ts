import "./update-overlay.css";
import { openUpdateOverlay } from "./update-overlay.js";

export function openKernelUpdates(component: "kernel" | "updater" | "neptune" = "kernel") {
  return openUpdateOverlay({ service: "kernel", component, base: "/api/update-flow" });
}
