import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentApi, briefApi, invitesApi, organizationApi, policiesApi, runbooksApi } from "../api/endpoints.js";
import { ApiError } from "../api/client.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Field, Select, TextInput } from "../components/ui/Field.js";
import { ErrorState, LoadingState } from "../components/ui/EmptyState.js";
import type { AutonomyPolicy, Organization, Role } from "../types.js";

export default function OrgSettingsPage() {
  const qc = useQueryClient();

  const orgQ = useQuery({
    queryKey: ["organization"],
    queryFn: () => organizationApi.get(),
  });
  const invitesQ = useQuery({
    queryKey: ["invites"],
    queryFn: () => invitesApi.list(),
  });

  const [name, setName] = useState("");
  useEffect(() => { if (orgQ.data) setName(orgQ.data.organization.name); }, [orgQ.data]);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => organizationApi.patch({ name }),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ["organization"] }); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("AGENT");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const sendInvite = useMutation({
    mutationFn: () => invitesApi.create(inviteEmail.trim().toLowerCase(), inviteRole),
    onSuccess: () => {
      setInviteEmail(""); setInviteRole("AGENT"); setInviteError(null);
      qc.invalidateQueries({ queryKey: ["invites"] });
    },
    onError: (err) => setInviteError(err instanceof ApiError ? err.message : "Could not send invite."),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => invitesApi.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites"] }),
  });

  function submitName(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    save.mutate();
  }

  function submitInvite(e: FormEvent) {
    e.preventDefault();
    sendInvite.mutate();
  }

  return (
    <>
      <Header title="Organization" subtitle="Workspace name, branding, and pending invites." />

      {orgQ.isLoading && <LoadingState />}
      {orgQ.error && <ErrorState message={(orgQ.error as Error).message} />}

      {orgQ.data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Workspace</p>
            <h3 className="font-display text-2xl mb-4">{orgQ.data.organization.name}</h3>
            <form onSubmit={submitName} className="space-y-4">
              <Field label="Name">
                <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Field label="Slug">
                <TextInput value={orgQ.data.organization.slug} disabled className="font-mono opacity-70" />
                <span className="text-xs text-ink/60 mt-1 block">The slug is permanent for now.</span>
              </Field>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" disabled={save.isPending || name === orgQ.data.organization.name}>
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            </form>
          </Card>

          <Card className="p-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Invites</p>
            <h3 className="font-display text-2xl mb-4">Bring teammates in</h3>

            <form onSubmit={submitInvite} className="space-y-3 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-3">
                <Field label="Email">
                  <TextInput type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
                </Field>
                <Field label="Role">
                  <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
                    <option value="EMPLOYEE">Employee</option>
                    <option value="AGENT">Agent</option>
                    <option value="ADMIN">Admin</option>
                  </Select>
                </Field>
              </div>
              {inviteError && <p className="text-sm text-red-600">{inviteError}</p>}
              <Button type="submit" disabled={sendInvite.isPending || !inviteEmail.trim()}>
                {sendInvite.isPending ? "Sending…" : "Send invite"}
              </Button>
            </form>

            <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-2">Pending + recent</p>
            {invitesQ.isLoading && <LoadingState />}
            {invitesQ.data && invitesQ.data.invites.length === 0 && (
              <p className="text-sm text-ink/60">No invites yet.</p>
            )}
            {invitesQ.data && invitesQ.data.invites.length > 0 && (
              <ul className="divide-y divide-ink/10">
                {invitesQ.data.invites.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm truncate"><span className="font-medium">{inv.email}</span> · <span className="font-mono text-xs text-ink/60">{inv.role}</span></p>
                      <p className="text-xs text-ink/60 font-mono">
                        {inv.acceptedAt
                          ? `Accepted ${new Date(inv.acceptedAt).toLocaleDateString()}`
                          : new Date(inv.expiresAt) < new Date()
                            ? "Expired"
                            : `Expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {inv.acceptedAt ? (
                        <Badge tone="success">Accepted</Badge>
                      ) : (
                        <>
                          <Badge tone="warn">Pending</Badge>
                          <Button variant="ghost" size="sm" onClick={() => revoke.mutate(inv.id)}>Revoke</Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="lg:col-span-2">
            <AgentTokensSection />
          </div>

          <div className="lg:col-span-2">
            <AutonomySection currentOrgSettings={orgQ.data.organization.settings ?? {}} />
          </div>

          <div className="lg:col-span-2">
            <RunbooksSection />
          </div>

          <div className="lg:col-span-2">
            <PoliciesSection />
          </div>

          <div className="lg:col-span-2">
            <IntegrationsSection currentOrgSettings={orgQ.data.organization.settings ?? {}} />
          </div>
        </div>
      )}
    </>
  );
}

// ─── Policies (admin) ────────────────────────────────────────────────

function PoliciesSection() {
  const qc = useQueryClient();
  const policiesQ = useQuery({
    queryKey: ["policies"], queryFn: () => policiesApi.list(),
  });
  const toggle = useMutation({
    mutationFn: (input: { key: string; disabled: boolean }) =>
      policiesApi.setDisabled(input.key, input.disabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["policies"] }),
  });

  return (
    <Card className="p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Guard-rails</p>
      <h3 className="font-display text-2xl mb-1">Policies</h3>
      <p className="text-sm text-ink/70 mb-5">
        The brain consults these before executing a runbook. A denied policy either escalates the run for human approval, or blocks it outright.
      </p>
      {policiesQ.isLoading && <LoadingState />}
      {policiesQ.data && (
        <ul className="divide-y divide-ink/10">
          {policiesQ.data.policies.map((p) => (
            <li key={p.key} className="flex items-start justify-between gap-4 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium">{p.name}</p>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-ink/50">{p.key}</span>
                </div>
                <p className="text-sm text-ink/70">{p.description}</p>
              </div>
              <div className="shrink-0 mt-1">
                {p.disabled ? (
                  <Button variant="secondary" size="sm" disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ key: p.key, disabled: false })}>Enable</Button>
                ) : (
                  <Button variant="ghost" size="sm" disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ key: p.key, disabled: true })}>Disable</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Integrations (Slack + GitHub + brief schedule) ─────────────────

function IntegrationsSection({ currentOrgSettings }: { currentOrgSettings: import("../types.js").Organization["settings"] }) {
  const qc = useQueryClient();
  const [slack, setSlack] = useState(currentOrgSettings?.slackWebhookUrl ?? "");
  const [repo, setRepo]   = useState((currentOrgSettings as { githubRepo?: string })?.githubRepo ?? "");
  const [cron, setCron]   = useState((currentOrgSettings as { briefSchedule?: string })?.briefSchedule ?? "0 8 * * *");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      organizationApi.patch({
        settings: { ...(currentOrgSettings ?? {}), ...patch },
      }),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ["organization"] }); },
    onError: (err) => setError(err instanceof Error ? err.message : "Could not save."),
  });

  const generateBrief = useMutation({
    mutationFn: () => briefApi.generate(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brief", "latest"] }),
  });

  return (
    <Card className="p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Integrations</p>
      <h3 className="font-display text-2xl mb-1">External channels</h3>
      <p className="text-sm text-ink/70 mb-5">
        Connect Slack for daily-brief + SLA-breach posts. Connect a GitHub repo so the autopilot can fire CI workflows for deploy/rebuild/rotate-secret tickets.
      </p>

      <div className="space-y-5">
        <Field
          label="Slack incoming webhook URL"
          hint="Leave blank to disable. Used for the morning brief and SLA breaches."
        >
          <TextInput
            value={slack}
            onChange={(e) => setSlack(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
          />
        </Field>
        <div>
          <Button size="sm" disabled={save.isPending}
            onClick={() => save.mutate({ slackWebhookUrl: slack.trim() })}>Save Slack</Button>
        </div>

        <hr className="border-ink/10" />

        <Field
          label="GitHub repo (owner/name)"
          hint="When set, the github_dispatch runbook can fire workflow_dispatch on this repo's 'relay-action.yml' workflow. The server-side GITHUB_TOKEN must have workflow scope."
        >
          <TextInput
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="acme-corp/relay-runbooks"
            className="font-mono"
          />
        </Field>
        <div>
          <Button size="sm" disabled={save.isPending}
            onClick={() => save.mutate({ githubRepo: repo.trim() })}>Save GitHub repo</Button>
        </div>

        <hr className="border-ink/10" />

        <Field
          label="Morning brief schedule (cron)"
          hint="Cron expression used to generate the daily brief. Default '0 8 * * *' = 08:00 UTC daily."
        >
          <TextInput value={cron} onChange={(e) => setCron(e.target.value)} className="font-mono" />
        </Field>
        <div className="flex gap-2">
          <Button size="sm" disabled={save.isPending}
            onClick={() => save.mutate({ briefSchedule: cron.trim() })}>Save schedule</Button>
          <Button size="sm" variant="secondary" disabled={generateBrief.isPending}
            onClick={() => generateBrief.mutate()}>
            {generateBrief.isPending ? "Generating…" : "Generate today's brief now"}
          </Button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Card>
  );
}

// ─── Agent tokens (admin) ─────────────────────────────────────────────

function AgentTokensSection() {
  const qc = useQueryClient();
  const tokensQ = useQuery({
    queryKey: ["agent-tokens"],
    queryFn: () => agentApi.listTokens(),
  });

  const [label, setLabel] = useState("");
  const [newPlaintext, setNewPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => agentApi.createToken(label.trim()),
    onSuccess: (r) => {
      setLabel("");
      setNewPlaintext(r.token.token ?? null);
      setError(null);
      qc.invalidateQueries({ queryKey: ["agent-tokens"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not create token."),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => agentApi.revokeToken(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-tokens"] }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    create.mutate();
  }

  return (
    <Card className="p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Agent tokens</p>
      <h3 className="font-display text-2xl mb-1">Asset auto-discovery</h3>
      <p className="text-sm text-ink/70 mb-5">
        Generate a token per fleet (e.g. "Engineering laptops"), then install the Relay agent on each
        device — see <code>/agent/README.md</code>. The agent posts CPU/RAM/disk every minute and
        Relay scores the device's health automatically.
      </p>

      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 mb-3">
        <Field label="Label">
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Engineering laptops" required />
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={create.isPending || !label.trim()}>
            {create.isPending ? "Generating…" : "Generate token"}
          </Button>
        </div>
        {error && <p className="md:col-span-2 text-sm text-red-600">{error}</p>}
      </form>

      {newPlaintext && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900 mb-2">Copy this now — it won't be shown again.</p>
          <p className="font-mono text-xs break-all bg-white border border-amber-200 rounded-xl p-3">{newPlaintext}</p>
          <p className="text-xs text-amber-800 mt-2">Drop it into the agent's <code>relay-agent.json</code> or pass via <code>--token</code>.</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setNewPlaintext(null)}>Dismiss</Button>
        </div>
      )}

      {tokensQ.data && tokensQ.data.tokens.length === 0 && (
        <p className="text-sm text-ink/60">No tokens yet. Generate one to enroll your first device.</p>
      )}

      {tokensQ.data && tokensQ.data.tokens.length > 0 && (
        <ul className="divide-y divide-ink/10">
          {tokensQ.data.tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{t.label}</p>
                <p className="text-xs text-ink/60 font-mono">
                  Created {new Date(t.createdAt).toLocaleDateString()}
                  {t.lastUsedAt ? ` · last used ${new Date(t.lastUsedAt).toLocaleString()}` : " · never used"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {t.revokedAt
                  ? <Badge tone="danger">Revoked</Badge>
                  : <>
                      <Badge tone="success">Active</Badge>
                      <Button variant="ghost" size="sm" onClick={() => revoke.mutate(t.id)}>Revoke</Button>
                    </>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Autonomy (admin) ────────────────────────────────────────────────

function AutonomySection({ currentOrgSettings }: { currentOrgSettings: Organization["settings"] }) {
  const qc = useQueryClient();
  const current: AutonomyPolicy = currentOrgSettings?.autonomy ?? "FULL_AUTO";
  const verify = currentOrgSettings?.verificationMinutes ?? 60;

  const setAutonomy = useMutation({
    mutationFn: (next: AutonomyPolicy) =>
      organizationApi.patch({
        settings: { ...(currentOrgSettings ?? {}), autonomy: next },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organization"] }),
  });
  const setVerify = useMutation({
    mutationFn: (mins: number) =>
      organizationApi.patch({
        settings: { ...(currentOrgSettings ?? {}), verificationMinutes: mins },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organization"] }),
  });

  const options: Array<{ value: AutonomyPolicy; label: string; desc: string }> = [
    { value: "FULL_AUTO",          label: "Full autopilot",        desc: "Brain runs any matched runbook (LOW + MEDIUM) and verifies on a timer. No human gate." },
    { value: "REVIEW_MEDIUM_HIGH", label: "Review medium/high",    desc: "Brain auto-runs LOW. MEDIUM + HIGH pause for an agent to approve before executing." },
    { value: "HUMAN_IN_LOOP",      label: "Human in the loop",     desc: "Brain stays out. Every fix is human-driven." },
  ];

  return (
    <Card className="p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Autopilot</p>
      <h3 className="font-display text-2xl mb-1">Autonomy</h3>
      <p className="text-sm text-ink/70 mb-5">
        How aggressively should the AI brain act on its own? Defaults to <strong>full autopilot</strong> — the
        brain picks a runbook, executes it, and verifies via a timer + reply detection. Learning data feeds
        back into future picks so the system gets better over time.
      </p>

      <ul className="space-y-2 mb-6">
        {options.map((o) => {
          const active = current === o.value;
          return (
            <li key={o.value}>
              <button
                type="button"
                onClick={() => setAutonomy.mutate(o.value)}
                disabled={setAutonomy.isPending || active}
                className={
                  "w-full text-left rounded-2xl border p-4 transition " +
                  (active
                    ? "border-ink bg-ink text-paper"
                    : "border-ink/15 hover:bg-ink/5")
                }
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="font-medium">{o.label}</p>
                  {active && <span className="font-mono text-[10px] uppercase tracking-widest text-lime">Active</span>}
                </div>
                <p className={"text-sm " + (active ? "text-paper/80" : "text-ink/70")}>{o.desc}</p>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-ink/10 pt-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-2">Verification window</p>
        <p className="text-sm text-ink/70 mb-3">
          After a runbook fires, the autopilot waits this long for a "didn't work" reply before closing the
          ticket. Negative replies trigger an immediate re-attempt.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="range" min={5} max={1440} step={5} defaultValue={verify}
            onChange={(e) => setVerify.mutate(parseInt(e.target.value, 10))}
            className="flex-1"
          />
          <span className="font-mono text-sm w-20 text-right">
            {verify >= 60 ? `${Math.round(verify / 60)} h` : `${verify} min`}
          </span>
        </div>
      </div>
    </Card>
  );
}

// ─── Runbooks (admin) ─────────────────────────────────────────────────

function RunbooksSection() {
  const qc = useQueryClient();
  const catalogQ = useQuery({
    queryKey: ["runbook-catalog"],
    queryFn: () => runbooksApi.catalog(),
  });

  const toggle = useMutation({
    mutationFn: (input: { key: string; disabled: boolean }) =>
      runbooksApi.setDisabled(input.key, input.disabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runbook-catalog"] }),
  });

  return (
    <Card className="p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Auto-remediation</p>
      <h3 className="font-display text-2xl mb-1">Runbooks</h3>
      <p className="text-sm text-ink/70 mb-5">
        Built-in actions the autopilot brain can choose from. <strong>LOW</strong> runs resolve the
        ticket immediately; <strong>MEDIUM</strong> runs enter the verification timer above;
        <strong>HIGH</strong> queues for an agent's one-click approval (or pauses under
        REVIEW_MEDIUM_HIGH autonomy). Toggle individual runbooks off if you don't want the
        brain reaching for them.
      </p>

      {catalogQ.isLoading && <LoadingState />}
      {catalogQ.data && (
        <ul className="divide-y divide-ink/10">
          {catalogQ.data.runbooks.map((rb) => (
            <li key={rb.key} className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium">{rb.name}</p>
                  <Badge tone={rb.risk === "HIGH" ? "danger" : rb.risk === "MEDIUM" ? "warn" : "success"}>{rb.risk}</Badge>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-ink/50">{rb.key}</span>
                </div>
                <p className="text-sm text-ink/70">{rb.description}</p>
              </div>
              <div className="shrink-0">
                {rb.disabled ? (
                  <Button
                    variant="secondary" size="sm"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ key: rb.key, disabled: false })}
                  >Enable</Button>
                ) : (
                  <Button
                    variant="ghost" size="sm"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ key: rb.key, disabled: true })}
                  >Disable</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
