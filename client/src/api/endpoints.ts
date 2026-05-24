/**
 * Typed wrappers around every endpoint. Pages import from here so the
 * raw fetch wrapper is never touched from UI code.
 */

import { apiDelete, apiGet, apiPatch, apiPost, postFile } from "./client.js";
import type {
  AgentToken, Analytics, Attachment, Comment, Device, DeviceMetric,
  Incident, Invite, InviteLookup, KbArticle, Organization, PlatformAnalytics,
  PlatformOrgSummary, RemoteSession, Role, RunbookCatalogEntry,
  RunbookExecution, ServiceComponent, SessionEvent, StatusPagePayload,
  SurveyStatus, Ticket, TicketStatus, TriagePreview, User,
} from "../types.js";

// ─── Auth ─────────────────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
  user: User;
  organization: Pick<Organization, "id" | "name" | "slug">;
}

export const authApi = {
  providers: () => apiGet<{ google: boolean; microsoft: boolean }>("/api/auth/providers"),
  me: () => apiGet<{ user: User; organization: Pick<Organization, "id" | "slug"> }>("/api/auth/me"),
  login: (orgSlug: string, email: string, password: string) =>
    apiPost<LoginResponse>("/api/auth/login", { orgSlug, email, password }),
  register: (input: {
    organizationName: string;
    organizationSlug?: string;
    name: string;
    email: string;
    password: string;
  }) => apiPost<LoginResponse>("/api/auth/register", input),
};

// ─── Tickets ──────────────────────────────────────────────────────────

export const ticketsApi = {
  list: () => apiGet<{ tickets: Ticket[] }>("/api/tickets"),
  get: (id: string) => apiGet<{ ticket: Ticket }>(`/api/tickets/${id}`),
  create: (description: string) =>
    apiPost<{ ticket: Ticket }>("/api/tickets", { description }),
  patch: (id: string, body: { status?: TicketStatus; assignedAgentId?: string | null }) =>
    apiPatch<{ ticket: Ticket }>(`/api/tickets/${id}`, body),
  triagePreview: (description: string) =>
    apiPost<TriagePreview>("/api/triage/preview", { description }),

  listComments: (id: string) => apiGet<{ comments: Comment[] }>(`/api/tickets/${id}/comments`),
  addComment: (id: string, body: string, isInternal: boolean) =>
    apiPost<{ comment: Comment }>(`/api/tickets/${id}/comments`, { body, isInternal }),

  listAttachments: (id: string) =>
    apiGet<{ attachments: Attachment[] }>(`/api/tickets/${id}/attachments`),
  uploadAttachment: (id: string, file: File) =>
    postFile<{ attachment: Attachment }>(`/api/tickets/${id}/attachments`, file),
  attachmentDownload: (attachmentId: string) =>
    apiGet<{ url: string; expiresIn: number; fileName: string; mimeType: string }>(
      `/api/attachments/${attachmentId}/download`,
    ),
};

// ─── Devices + remote sessions ────────────────────────────────────────

export const devicesApi = {
  list: () => apiGet<{ devices: Device[] }>("/api/devices"),
  patch: (id: string, body: Partial<Device>) =>
    apiPatch<{ device: Device }>(`/api/devices/${id}`, body),

  startSession: (deviceId: string) =>
    apiPost<{ session: RemoteSession }>("/api/remote-sessions", { deviceId }),
  appendEvent: (sessionId: string, event: { type: string; message: string }) =>
    apiPatch<{ session: RemoteSession }>(`/api/remote-sessions/${sessionId}/events`, { event }),
  endSession: (sessionId: string) =>
    apiPatch<{ session: RemoteSession }>(`/api/remote-sessions/${sessionId}/end`, {}),
  getSession: (sessionId: string) =>
    apiGet<{ session: RemoteSession }>(`/api/remote-sessions/${sessionId}`),

  // Phase 10C — co-pilot manual dispatch + history
  dispatchAction: (deviceId: string, kind: import("../types.js").AgentActionKind, input: Record<string, unknown> = {}) =>
    apiPost<{ action: import("../types.js").AgentAction }>(`/api/devices/${deviceId}/actions`, { kind, input }),
  listActions: (deviceId: string) =>
    apiGet<{ actions: import("../types.js").AgentAction[] }>(`/api/devices/${deviceId}/actions`),
};

// ─── Runbooks (Phase 10A — auto-remediation) ──────────────────────────

export const runbooksApi = {
  catalog: () => apiGet<{ runbooks: RunbookCatalogEntry[] }>("/api/runbook-catalog"),
  setDisabled: (key: string, disabled: boolean) =>
    apiPatch<{ runbooks: RunbookCatalogEntry[] }>(`/api/runbook-catalog/${key}`, { disabled }),
  listForTicket: (ticketId: string) =>
    apiGet<{ executions: RunbookExecution[] }>(`/api/tickets/${ticketId}/runbook-executions`),
  confirm: (executionId: string, fixed: boolean) =>
    apiPost<{ ticketId: string; status: string }>(`/api/runbook-executions/${executionId}/confirm`, { fixed }),
  approve: (executionId: string) =>
    apiPost<{ ticketId: string }>(`/api/runbook-executions/${executionId}/approve`, {}),
};

// ─── Phase 11 — policies + daily brief ────────────────────────────────

export const policiesApi = {
  list: () =>
    apiGet<{ policies: import("../types.js").PolicyCatalogEntry[] }>("/api/policies"),
  setDisabled: (key: string, disabled: boolean) =>
    apiPatch<{ policies: import("../types.js").PolicyCatalogEntry[] }>(`/api/policies/${key}`, { disabled }),
};

export const briefApi = {
  latest: () =>
    apiGet<{ brief: import("../types.js").DailyBrief | null }>("/api/brief/latest"),
  list: () =>
    apiGet<{ briefs: import("../types.js").DailyBrief[] }>("/api/brief"),
  generate: () =>
    apiPost<{ generated: boolean; brief: { briefId: string; markdown: string } | null }>("/api/brief/generate", {}),
};

// ─── Phase 27 — Behavioural defence (MITRE ATT&CK + generated rules) ──

export const attackApi = {
  techniques: (params: { tactic?: string; q?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.tactic) qs.set("tactic", params.tactic);
    if (params.q)      qs.set("q", params.q);
    if (params.limit)  qs.set("limit", String(params.limit));
    const suf = qs.toString() ? `?${qs}` : "";
    return apiGet<{ techniques: import("../types.js").AttackTechnique[] }>(`/api/attack/techniques${suf}`);
  },
  coverage: () =>
    apiGet<import("../types.js").AttackCoverage>("/api/attack/coverage"),
  ingest: () =>
    apiPost<{ ok: boolean; techniquesUpserted: number; techniquesRevoked: number; bundleObjects: number; durationMs: number }>("/api/attack/ingest", {}),

  listRules: (status?: import("../types.js").GeneratedRuleStatus) =>
    apiGet<{ rules: import("../types.js").GeneratedRule[] }>(
      status ? `/api/attack/rules?status=${status}` : "/api/attack/rules",
    ),
  getRule: (id: string) =>
    apiGet<{ rule: import("../types.js").GeneratedRule }>(`/api/attack/rules/${id}`),
  testRule: (id: string) =>
    apiPost<{ report: import("../types.js").GeneratedRule["testResults"] }>(`/api/attack/rules/${id}/test`, {}),
  approveRule: (id: string) =>
    apiPost<{ rule: import("../types.js").GeneratedRule }>(`/api/attack/rules/${id}/approve`, {}),
  rejectRule: (id: string, reason: string) =>
    apiPost<{ rule: import("../types.js").GeneratedRule }>(`/api/attack/rules/${id}/reject`, { reason }),
  retireRule: (id: string) =>
    apiPost<{ rule: import("../types.js").GeneratedRule }>(`/api/attack/rules/${id}/retire`, {}),

  recentAlerts: (limit = 50) =>
    apiGet<{ alerts: import("../types.js").SensorAlertRow[] }>(`/api/attack/sensors/alerts?limit=${limit}`),

  runStudyNow: () =>
    apiPost<{
      iterations: number;
      newDraftsCreated: number;
      techniquesConsidered: number;
      mode?: "ai" | "demo";
      mitreEmpty?: boolean;
      error?: string;
    }>("/api/attack/study/run-now", {}),
};

// ─── Phase 26 — Daily defender agent ─────────────────────────────────

export const defenderApi = {
  listRuns: () =>
    apiGet<{ runs: import("../types.js").DefenderRun[] }>("/api/defender/runs"),
  getRun: (id: string) =>
    apiGet<{ run: import("../types.js").DefenderRun }>(`/api/defender/runs/${id}`),
  latest: () =>
    apiGet<{ run: import("../types.js").DefenderRun | null }>("/api/defender/latest"),
  runNow: () =>
    apiPost<{ defenderRunId: string; status: string; iterations: number; decisions: unknown[]; briefing: string }>("/api/defender/run-now", {}),
};

// ─── Phase 25 — Threat intelligence ──────────────────────────────────

export const threatApi = {
  listIntel: (kind?: import("../types.js").ThreatKind) =>
    apiGet<{ intel: import("../types.js").ThreatIntel[] }>(
      `/api/threat/intel${kind ? `?kind=${kind}` : ""}`,
    ),
  listMatches: (include: "open" | "all" = "open") =>
    apiGet<{ matches: import("../types.js").ThreatMatch[] }>(
      `/api/threat/matches?include=${include}`,
    ),
  acknowledgeMatch: (id: string) =>
    apiPost<{ match: import("../types.js").ThreatMatch }>(`/api/threat/matches/${id}/ack`, {}),
  dismissMatch: (id: string) =>
    apiPost<{ match: import("../types.js").ThreatMatch }>(`/api/threat/matches/${id}/dismiss`, {}),
  convertToTicket: (id: string, priority: "Critical" | "High" | "Medium" | "Low" = "High") =>
    apiPost<{ ticket: { id: string; refCode: string }; match: import("../types.js").ThreatMatch }>(
      `/api/threat/matches/${id}/ticket`, { priority },
    ),
  ingest: () =>
    apiPost<{ ok: boolean; results: Array<{ source: string; fetched: number; newIntel: number; newMatches: number; error?: string }> }>(
      "/api/threat/ingest", {},
    ),
};

// ─── Phase 12 — detection ────────────────────────────────────────────

export const detectionsApi = {
  listRules: () =>
    apiGet<{ rules: import("../types.js").DetectionRuleEntry[] }>("/api/detections/rules"),
  setRuleDisabled: (key: string, disabled: boolean) =>
    apiPatch<{ ok: boolean }>(`/api/detections/rules/${key}`, { disabled }),
  listHits: (include: "open" | "all" = "open") =>
    apiGet<{ hits: import("../types.js").DetectionHit[] }>(`/api/detections/hits?include=${include}`),
  acknowledge: (id: string) =>
    apiPost<{ hit: import("../types.js").DetectionHit }>(`/api/detections/hits/${id}/ack`, {}),
  run: () =>
    apiPost<{ ok: boolean; hitsCreated: number }>("/api/detections/run", {}),
};

// ─── Phase 16 — ML model management ──────────────────────────────────

export const mlApi = {
  listModels: () =>
    apiGet<{ models: import("../types.js").MlModel[] }>("/api/ml/models"),
  train: () =>
    apiPost<{ ok: boolean; version: number; metrics: import("../types.js").MlModelMetrics }>("/api/ml/train", {}),
  activate: (id: string) =>
    apiPost<{ ok: boolean; model: import("../types.js").MlModel }>(`/api/ml/models/${id}/activate`, {}),
};

// ─── Phase 13 — workflows ────────────────────────────────────────────

export const workflowsApi = {
  list: () =>
    apiGet<{ workflows: import("../types.js").WorkflowCatalogEntry[] }>("/api/workflows"),
  start: (ticketId: string, workflowKey?: string) =>
    apiPost<{ workflowExecutionId: string; workflowKey: string }>("/api/workflows", { ticketId, workflowKey }),
  listExecutions: (ticketId?: string) =>
    apiGet<{ executions: import("../types.js").WorkflowExecution[] }>(
      ticketId ? `/api/workflows/executions?ticketId=${ticketId}` : "/api/workflows/executions",
    ),
  getExecution: (id: string) =>
    apiGet<{ execution: import("../types.js").WorkflowExecution }>(`/api/workflows/executions/${id}`),
  approve: (id: string, stepKey: string) =>
    apiPost<{ ok: boolean }>(`/api/workflows/executions/${id}/approve`, { stepKey }),
  cancel: (id: string, reason?: string) =>
    apiPost<{ ok: boolean }>(`/api/workflows/executions/${id}/cancel`, { reason }),
  tick: () =>
    apiPost<{ ok: boolean; advanced: number }>("/api/workflows/tick", {}),
};

// ─── Agent tokens + device metrics ────────────────────────────────────

export const agentApi = {
  listTokens: () => apiGet<{ tokens: AgentToken[] }>("/api/agent-tokens"),
  createToken: (label: string) =>
    apiPost<{ token: AgentToken & { token: string } }>("/api/agent-tokens", { label }),
  revokeToken: (id: string) =>
    apiPost<{ token: AgentToken }>(`/api/agent-tokens/${id}/revoke`, {}),
  metrics: (deviceId: string, hours = 24) =>
    apiGet<{ metrics: DeviceMetric[] }>(`/api/devices/${deviceId}/metrics?hours=${hours}`),
};

// ─── KB ───────────────────────────────────────────────────────────────

export const kbApi = {
  search: (q: string) =>
    apiGet<{ articles: KbArticle[] }>(`/api/kb${q ? `?q=${encodeURIComponent(q)}` : ""}`),
};

// ─── Users (admin) ────────────────────────────────────────────────────

export const usersApi = {
  list: () => apiGet<{ users: User[] }>("/api/users"),
  create: (input: { name: string; email: string; password: string; role: Role }) =>
    apiPost<{ user: User }>("/api/users", input),
  patch: (id: string, body: { name?: string; role?: Role }) =>
    apiPatch<{ user: User }>(`/api/users/${id}`, body),
  remove: (id: string) => apiDelete<void>(`/api/users/${id}`),
};

// ─── Incidents (admin) + components ───────────────────────────────────

export const incidentsApi = {
  list: () => apiGet<{ incidents: Incident[] }>("/api/incidents"),
  components: () => apiGet<{ components: ServiceComponent[] }>("/api/incidents/components"),
  create: (body: {
    title: string;
    status?: Incident["status"];
    impact?: Incident["impact"];
    componentId: string;
    message: string;
    componentStatus?: ServiceComponent["status"];
  }) => apiPost<{ incident: Incident }>("/api/incidents", body),
  addUpdate: (id: string, body: {
    status: Incident["status"];
    message: string;
    componentStatus?: ServiceComponent["status"];
    resolved?: boolean;
  }) => apiPost<{ incident: Incident }>(`/api/incidents/${id}/updates`, body),
};

// ─── Organization (current tenant settings) ───────────────────────────

export const organizationApi = {
  get: () => apiGet<{ organization: Organization }>("/api/organization"),
  patch: (body: { name?: string; settings?: Organization["settings"] }) =>
    apiPatch<{ organization: Organization }>("/api/organization", body),
};

// ─── Invites (admin + public accept) ──────────────────────────────────

export const invitesApi = {
  list: () => apiGet<{ invites: Invite[] }>("/api/invites"),
  create: (email: string, role: Role) =>
    apiPost<{ invite: Invite }>("/api/invites", { email, role }),
  revoke: (id: string) => apiDelete<void>(`/api/invites/${id}`),

  // Public — no auth
  lookup: (token: string) =>
    apiGet<InviteLookup>(`/api/invites/lookup/${token}`),
  accept: (token: string, name: string, password: string) =>
    apiPost<LoginResponse>(`/api/invites/lookup/${token}`, { name, password }),
};

// ─── Platform admin (cross-org) ───────────────────────────────────────

export const platformApi = {
  listOrganizations: () =>
    apiGet<{ organizations: PlatformOrgSummary[] }>("/api/platform/organizations"),
  createOrganization: (name: string, slug?: string) =>
    apiPost<{ organization: Organization }>("/api/platform/organizations", { name, slug }),
  setSuspended: (id: string, suspended: boolean) =>
    apiPatch<{ organization: Organization }>(`/api/platform/organizations/${id}/suspend`, { suspended }),
  deleteOrganization: (id: string) =>
    apiDelete<void>(`/api/platform/organizations/${id}`),
  analytics: () => apiGet<PlatformAnalytics>("/api/platform/analytics"),
};

// ─── Public ───────────────────────────────────────────────────────────

export const publicApi = {
  status: (orgSlug: string) => apiGet<StatusPagePayload>(`/api/status/${orgSlug}`),
  surveyGet: (token: string) => apiGet<SurveyStatus>(`/api/survey/${token}`),
  surveySubmit: (token: string, rating: number, comment?: string) =>
    apiPost<SurveyStatus>(`/api/survey/${token}`, { rating, comment }),
};

// ─── Analytics ────────────────────────────────────────────────────────

export const analyticsApi = {
  get: () => apiGet<Analytics>("/api/analytics"),
};

// Re-export for convenience.
export type { SessionEvent };
