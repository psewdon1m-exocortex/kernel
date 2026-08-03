import { createHash } from "node:crypto";

export const REGISTER_MEDIA_TYPE = "application/vnd.exocortex.register+json; version=1";
export const CONSTITUTION_MEDIA_TYPE = "application/vnd.exocortex.constitution+json; version=1";

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function checksumOf(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function expandDottedValues(flatValues) {
  const result = {};
  for (const key of Object.keys(flatValues).sort()) {
    const parts = key.split(".");
    let cursor = result;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (
        Object.hasOwn(cursor, part)
        && (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part]))
      ) {
        throw Object.assign(new Error(`Register key ${key} conflicts with a parent value`), {
          status: 409,
          code: "REGISTER_KEY_CONFLICT",
        });
      }
      cursor[part] ??= {};
      cursor = cursor[part];
    }
    const leaf = parts.at(-1);
    if (Object.hasOwn(cursor, leaf)) {
      throw Object.assign(new Error(`Register key ${key} conflicts with another value`), {
        status: 409,
        code: "REGISTER_KEY_CONFLICT",
      });
    }
    cursor[leaf] = flatValues[key];
  }
  return result;
}

export function registerChecksum(values) {
  return checksumOf({ values });
}

function splitExplicitId(rawTitle) {
  const match = rawTitle.match(/\s+\{#([A-Za-z0-9][A-Za-z0-9._-]{0,127})\}\s*$/);
  if (!match) return { title: rawTitle.trim(), explicitId: null };
  return {
    title: rawTitle.slice(0, match.index).trim(),
    explicitId: match[1],
  };
}

function slugify(value) {
  const slug = value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

export function parseConstitution(markdown) {
  const headings = [];
  const expression = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm;
  let match;
  while ((match = expression.exec(markdown)) !== null) {
    const { title, explicitId } = splitExplicitId(match[2]);
    headings.push({
      title,
      explicitId,
      level: match[1].length,
      start: match.index,
      contentStart: expression.lastIndex,
    });
  }

  const firstTitle = headings.find((heading) => heading.level === 1)?.title
    ?? "Exocortex Constitution";
  const usedIds = new Map();
  const sections = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (index === 0 && heading.level === 1) continue;
    const baseId = heading.explicitId || slugify(heading.title);
    const collision = (usedIds.get(baseId) ?? 0) + 1;
    usedIds.set(baseId, collision);
    const id = collision === 1 ? baseId : `${baseId}-${collision}`;
    const next = headings[index + 1];
    const content = markdown
      .slice(heading.contentStart, next?.start ?? markdown.length)
      .replace(/^\r?\n/, "")
      .trimEnd();
    sections.push({
      id,
      title: heading.title,
      level: heading.level,
      order: sections.length + 1,
      content_markdown: content,
    });
  }
  return { title: firstTitle, sections };
}

export function etagMatches(header, revision) {
  if (!header) return false;
  const expected = `"${revision}"`;
  return String(header)
    .split(",")
    .map((item) => item.trim().replace(/^W\//, ""))
    .some((item) => item === expected || item === "*");
}
