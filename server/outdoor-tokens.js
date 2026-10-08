import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadPrincipals, validatePrincipals, PRINCIPALS_SETTING, OUTDOOR_KEYS } from "./machine-principals.js";

export function mountOutdoorTokens(app, { store, requireOperator }) {
  const publicToken = ({ id, name, enabled }) => ({ id, name, enabled });
  const save = (values, action, id) => store.transaction(() => {
    store.setSetting(PRINCIPALS_SETTING, JSON.stringify(validatePrincipals(values)));
    store.audit("operator", action, id, "success", {});
  });
  app.get("/api/outdoor-tokens", requireOperator, (_req, res) => {
    res.json({ tokens: loadPrincipals(store).filter(item => item.profile === "outdoor").map(publicToken) });
  });
  app.post("/api/outdoor-tokens", requireOperator, (req, res) => {
    if (typeof req.body?.name !== "string" || !req.body.name.trim() || req.body.name.trim().length > 80 || /[\r\n\x00]/.test(req.body.name)) return res.status(400).json({ error: "Token name is invalid" });
    const token = randomBytes(32).toString("base64url");
    const principal = { id: "outdoor_" + randomUUID().replaceAll("-", ""), name: req.body.name.trim(), profile: "outdoor", enabled: true, allowed_keys: [...OUTDOOR_KEYS], token_sha256: createHash("sha256").update(token).digest("hex") };
    save([...loadPrincipals(store), principal], "outdoor-token.created", principal.id);
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ ...publicToken(principal), token });
  });
  app.post("/api/outdoor-tokens/:id/rotate", requireOperator, (req, res) => {
    const values = loadPrincipals(store), principal = values.find(item => item.id === req.params.id && item.profile === "outdoor");
    if (!principal) return res.status(404).json({ error: "Outdoor token not found" });
    if (!principal.enabled) return res.status(409).json({ error: "Outdoor token is revoked" });
    const token = randomBytes(32).toString("base64url");
    principal.token_sha256 = createHash("sha256").update(token).digest("hex");
    save(values, "outdoor-token.rotated", principal.id);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...publicToken(principal), token });
  });
  app.delete("/api/outdoor-tokens/:id", requireOperator, (req, res) => {
    const values = loadPrincipals(store), principal = values.find(item => item.id === req.params.id && item.profile === "outdoor");
    if (!principal) return res.status(404).json({ error: "Outdoor token not found" });
    principal.enabled = false;
    save(values, "outdoor-token.revoked", principal.id);
    res.json(publicToken(principal));
  });
}
