import { createHash } from "node:crypto";
import { validateConfig, CONFIG_SCHEMA } from "./wyvern-contract/config.js";
import { fields, ID, HASH, canonical } from "./wyvern-contract/util.js";
import { loadPrincipals, validatePrincipals, PRINCIPALS_SETTING } from "./machine-principals.js";

const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const sha = value => createHash("sha256").update(value).digest("hex");
const keyFor = instance => "wyvern.instances." + instance + ".config";
const credentialKey = (instance, adapter) => "wyvern.credentials." + sha(instance + ":" + adapter);
const principalID = (instance, role) => "wyvern_" + role + "_" + sha(instance).slice(0, 24);

export function mountWyvern(app, { store, activeVoltClient, requireOperator, requireMachine, legacyToken }) {
  const pending = new Map();
  const lock = async (instance, callback) => {
    if (pending.has(instance)) fail(409, "WYVERN_OPERATION_IN_PROGRESS");
    pending.set(instance, true);
    try { return await callback(); } finally { pending.delete(instance); }
  };
  function syncReferences(instance, metadata) {
    const entries = store.listRegisterEntries();
    const existing = new Map(entries.map(entry => [entry.key, entry.value]));
    const expected = new RegExp("^volt://[a-f0-9-]{36}/1$", "i");
    const changes = [];
    for (const [key, value] of Object.entries(metadata.references)) {
      if ((key !== keyFor(instance) && !/^wyvern\.credentials\.[a-f0-9]{64}$/.test(key)) || !expected.test(value)) fail(503, "WYVERN_REFERENCE_INVALID");
      if (existing.get(key) !== value) changes.push({ key, value, description: "Wyvern managed binding" });
    }
    store.transaction(() => {
      if (changes.length) store.upsertRegisterEntries(changes, "service:wyvern-manager", { replace: false });
      const principals = loadPrincipals(store);
      const runtime = principals.find(item => item.id === principalID(instance, "runtime"));
      if (runtime) {
        runtime.allowed_keys = Object.keys(metadata.references);
        store.setSetting(PRINCIPALS_SETTING, JSON.stringify(validatePrincipals(principals)));
      }
    });
  }
  async function current(instance, { initialize = false } = {}) {
    const volt = activeVoltClient();
    let metadata = await volt.wyvern("inspect", { instance_id: instance });
    if (!metadata.revision && initialize) metadata = await volt.wyvern("publish", {
      instance_id: instance, expected_revision: 0, request_id: "initialize-" + sha(instance), credentials: {},
      config: { schema: CONFIG_SCHEMA, instance_id: instance, adapters: {}, clients: {} },
    });
    if (!metadata.revision) fail(404, "WYVERN_INSTANCE_NOT_FOUND");
    syncReferences(instance, metadata);
    const ref = metadata.references[keyFor(instance)];
    const values = await volt.resolve([ref]);
    const entry = values.values[ref];
    if (entry.revision !== metadata.revision) fail(409, "WYVERN_REVISION_CONFLICT");
    let config;
    try { config = JSON.parse(entry.value); validateConfig(config); } catch { fail(503, "WYVERN_CONFIG_INVALID"); }
    return { schema: "exocortex.kernel.wyvern.v1", instance_id: instance, revision: entry.revision, config, metadata };
  }
  function authorize(req, allowRuntime = false) {
    const instance = req.params.instance;
    const grant = req.auth?.principal?.wyvern;
    if (!ID.test(instance) || !grant || grant.instance_id !== instance || grant.role !== "manager" && !(allowRuntime && grant.role === "runtime")) fail(403, "WYVERN_SCOPE_DENIED");
    return instance;
  }
  app.post("/api/wyvern/instances/:instance/enroll", requireOperator, async (req, res, next) => {
    try {
      const instance = req.params.instance;
      fields(req.body, ["manager_token_sha256", "runtime_token_sha256"], ["manager_token_sha256", "runtime_token_sha256"]);
      if (!ID.test(instance) || !HASH.test(req.body.manager_token_sha256) || !HASH.test(req.body.runtime_token_sha256) ||
          req.body.manager_token_sha256 === req.body.runtime_token_sha256 || [req.body.manager_token_sha256, req.body.runtime_token_sha256].includes(sha(legacyToken || ""))) fail(400, "WYVERN_IDENTITY_INVALID");
      await lock(instance, async () => {
        const result = await current(instance, { initialize: true });
        const principals = loadPrincipals(store).filter(item => ![principalID(instance, "manager"), principalID(instance, "runtime")].includes(item.id));
        for (const role of ["manager", "runtime"]) principals.push({ id: principalID(instance, role), enabled: true,
          token_sha256: req.body[role + "_token_sha256"], allowed_keys: role === "runtime" ? Object.keys(result.metadata.references) : [], wyvern: { instance_id: instance, role } });
        store.transaction(() => {
          if (result.metadata.repository_ref && !store.listRegisterEntries().some(row => row.key === "repositories.wyvern.url")) {
            store.upsertRegisterEntries([{ key: "repositories.wyvern.url", value: result.metadata.repository_ref, description: "Wyvern release repository" }], "operator", { replace: false });
          }
          store.setSetting(PRINCIPALS_SETTING, JSON.stringify(validatePrincipals(principals)));
          store.audit("operator", "wyvern.enroll", instance, "success", { revision: result.revision });
        });
        res.json({ schema: "exocortex.kernel.wyvern.enrollment.v1", instance_id: instance, config_key: keyFor(instance), revision: result.revision });
      });
    } catch (error) { next(error); }
  });
  app.get("/api/v1/wyvern/:instance", requireMachine, async (req, res, next) => {
    try {
      const instance = authorize(req);
      const result = await lock(instance, () => current(instance));
      delete result.metadata; res.json(result);
    } catch (error) { next(error); }
  });
  app.post("/api/v1/wyvern/:instance/mutations", requireMachine, async (req, res, next) => {
    try {
      const instance = authorize(req, true);
      fields(req.body, ["operation", "expected_revision", "request_id", "adapter_id", "adapter", "credential", "client_id", "client", "bindings"], ["operation", "expected_revision", "request_id"]);
      const input = req.body;
      if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 1 || !/^[A-Za-z0-9_-]{16,128}$/.test(input.request_id)) fail(400, "WYVERN_REQUEST_INVALID");
      if (req.auth.principal.wyvern.role === "runtime" && input.operation !== "bind") fail(403, "WYVERN_SCOPE_DENIED");
      await lock(instance, async () => {
        const result = await current(instance);
        const operationHash = sha(canonical(input));
        if (result.metadata.last_request_id === input.request_id) {
          if (result.metadata.last_operation_hash !== operationHash) fail(409, "WYVERN_REQUEST_CONFLICT");
          delete result.metadata; res.json(result); return;
        }
        // An uncertain publication must be inspected; never silently rebase it.
        if (result.revision !== input.expected_revision) fail(409, "WYVERN_REVISION_CONFLICT");
        const config = structuredClone(result.config), credentials = {};
        switch (input.operation) {
          case "adapter.put":
            if (!ID.test(input.adapter_id) || !input.adapter || input.client || input.client_id || input.bindings) fail(400, "WYVERN_REQUEST_INVALID");
            fields(input.adapter, ["name", "driver", "endpoint", "profiles", "enabled", "max_concurrent", "request_timeout_ms"], ["name", "driver", "profiles", "enabled"]);
            config.adapters[input.adapter_id] = { ...input.adapter, credential_ref: credentialKey(instance, input.adapter_id) };
            if (input.credential !== undefined) credentials[input.adapter_id] = input.credential;
            break;
          case "adapter.delete":
            if (!ID.test(input.adapter_id) || !Object.hasOwn(config.adapters, input.adapter_id) || input.adapter || input.credential || input.client || input.client_id || input.bindings) fail(400, "WYVERN_REQUEST_INVALID");
            if (Object.values(config.clients).some(client => Object.values(client.bindings).some(binding => binding.adapter_id === input.adapter_id))) fail(409, "WYVERN_ADAPTER_IN_USE");
            delete config.adapters[input.adapter_id];
            for (const client of Object.values(config.clients)) client.allowed_adapters = client.allowed_adapters.filter(id => id !== input.adapter_id);
            break;
          case "client.put":
            if (!ID.test(input.client_id) || !input.client || input.adapter_id || input.adapter || input.credential || input.bindings) fail(400, "WYVERN_REQUEST_INVALID");
            config.clients[input.client_id] = input.client;
            break;
          case "bind": {
            if (!ID.test(input.client_id) || input.client || input.adapter_id || input.adapter || input.credential || !input.bindings) fail(400, "WYVERN_REQUEST_INVALID");
            const client = config.clients[input.client_id];
            if (!client?.enabled) fail(403, "WYVERN_CLIENT_DENIED");
            client.bindings = input.bindings;
            break;
          }
          default: fail(400, "WYVERN_OPERATION_INVALID");
        }
        try { validateConfig(config); } catch { fail(400, "WYVERN_CONFIG_INVALID"); }
        const metadata = await activeVoltClient().wyvern("publish", { instance_id: instance, expected_revision: input.expected_revision, request_id: input.request_id, operation_hash: operationHash, config, credentials });
        syncReferences(instance, metadata);
        store.audit(req.auth.actor, "wyvern." + input.operation, instance, "success", { revision: metadata.revision });
        res.json({ schema: "exocortex.kernel.wyvern.v1", instance_id: instance, revision: metadata.revision, config });
      });
    } catch (error) { next(error); }
  });
}
