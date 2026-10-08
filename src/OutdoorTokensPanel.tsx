import { useEffect, useState } from "react";
import { api } from "./api";
import { ConfirmDialog, Modal } from "./components";

type OutdoorToken = { id: string; name: string; enabled: boolean };
export function OutdoorTokensPanel() {
  const [tokens, setTokens] = useState<OutdoorToken[]>([]);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string>();
  const [candidate, setCandidate] = useState<OutdoorToken>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const load = async () => setTokens((await api<{ tokens: OutdoorToken[] }>("/api/outdoor-tokens")).tokens);
  useEffect(() => { void load().catch(() => setError("Outdoor tokens could not be loaded.")); }, []);
  const issue = async (id?: string) => {
    setPending(true); setError("");
    try {
      const result = await api<OutdoorToken & { token: string }>(id ? `/api/outdoor-tokens/${encodeURIComponent(id)}/rotate` : "/api/outdoor-tokens", { method: "POST", body: JSON.stringify(id ? {} : { name }) });
      setSecret(result.token); setName(""); await load();
    } catch { setError("Outdoor token could not be issued."); }
    finally { setPending(false); }
  };
  const revoke = async () => {
    if (!candidate) return;
    setPending(true); setError("");
    try { await api(`/api/outdoor-tokens/${encodeURIComponent(candidate.id)}`, { method: "DELETE" }); setCandidate(undefined); await load(); }
    catch { setError("Outdoor token could not be revoked."); }
    finally { setPending(false); }
  };
  return <div className="settings-group outdoor-tokens">
    <h3>Outdoor service tokens</h3>
    <p>External agents can discover Saturn and Pluto releases. Each installation has its own restricted token.</p>
    <form onSubmit={event => { event.preventDefault(); void issue(); }}><label>Token name<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></label><button disabled={pending} type="submit">Create token</button></form>
    {error ? <p role="alert">{error}</p> : null}
    {tokens.map(token => <div className="outdoor-token" key={token.id}><strong>{token.name}</strong><span>{token.enabled ? "Active" : "Revoked"}</span><div className="dialog-actions"><button type="button" disabled={pending || !token.enabled} onClick={() => void issue(token.id)}>Rotate token</button><button className="danger" type="button" disabled={pending || !token.enabled} onClick={() => setCandidate(token)}>Revoke</button></div></div>)}
    {secret ? <Modal title="Outdoor service token" onClose={() => setSecret(undefined)}><p>Copy this token into Pluto TUI. It is shown only once.</p><label>Outdoor service token<textarea aria-label="Outdoor service token" readOnly value={secret} spellCheck={false} /></label><button type="button" onClick={() => setSecret(undefined)}>Done</button></Modal> : null}
    {candidate ? <ConfirmDialog title={`Revoke ${candidate.name}?`} message="This agent will lose access to Kernel discovery and release information." detail="Saturn pipeline access is managed separately in Synchronization." confirmLabel="Revoke token" pending={pending} onConfirm={() => void revoke()} onClose={() => setCandidate(undefined)} /> : null}
  </div>;
}
