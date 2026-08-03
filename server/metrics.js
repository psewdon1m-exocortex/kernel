import fs from "node:fs";
import os from "node:os";

function cpuSnapshot() {
  const cores = os.cpus();
  let idle = 0;
  let total = 0;
  for (const core of cores) {
    idle += core.times.idle;
    total += Object.values(core.times).reduce((sum, value) => sum + value, 0);
  }
  return { idle, total, cores: cores.length };
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function createMetricsCollector(diskPath = "/") {
  let previous = cpuSnapshot();
  let cpuPercent = null;
  const timer = setInterval(() => {
    const current = cpuSnapshot();
    const totalDelta = current.total - previous.total;
    const idleDelta = current.idle - previous.idle;
    cpuPercent = totalDelta > 0
      ? Math.round((1 - idleDelta / totalDelta) * 1000) / 10
      : null;
    previous = current;
  }, 1000);
  timer.unref?.();

  return {
    read() {
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      let disk = {
        used_bytes: null,
        free_bytes: null,
        total_bytes: null,
        percent: null,
      };
      try {
        const stat = fs.statfsSync(diskPath);
        const total = Number(stat.blocks) * Number(stat.bsize);
        const free = Number(stat.bavail) * Number(stat.bsize);
        const used = Math.max(0, total - free);
        disk = {
          used_bytes: finiteOrNull(used),
          free_bytes: finiteOrNull(free),
          total_bytes: finiteOrNull(total),
          percent: total > 0 ? Math.round((used / total) * 1000) / 10 : null,
        };
      } catch {
        // An unavailable metric is represented as null and rendered as N/A.
      }
      const usedMemory = Math.max(0, totalMemory - freeMemory);
      return {
        collected_at: new Date().toISOString(),
        cpu: {
          usage_percent: cpuPercent,
          cores: previous.cores,
          load_1m: finiteOrNull(os.loadavg()[0]),
          load_5m: finiteOrNull(os.loadavg()[1]),
          load_15m: finiteOrNull(os.loadavg()[2]),
        },
        ram: {
          used_bytes: usedMemory,
          free_bytes: freeMemory,
          total_bytes: totalMemory,
          percent: totalMemory > 0
            ? Math.round((usedMemory / totalMemory) * 1000) / 10
            : null,
        },
        disk,
        uptime_seconds: Math.round(os.uptime()),
        hostname: os.hostname(),
        platform: os.platform(),
      };
    },
    close() {
      clearInterval(timer);
    },
  };
}
