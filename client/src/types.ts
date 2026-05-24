// Shared API types. Kept in one file so pages don't drift from the server.

export type Role = "EMPLOYEE" | "AGENT" | "ADMIN";
export type AuthProvider = "LOCAL" | "GOOGLE" | "MICROSOFT";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";
export type TicketSource = "PORTAL" | "EMAIL";
export type HealthStatus = "HEALTHY" | "WARNING" | "CRITICAL";
export type DeviceType = "LAPTOP" | "DESKTOP" | "MOBILE";
export type SessionStatus = "CONNECTING" | "LIVE" | "ENDED";
export type ComponentStatus = "OPERATIONAL" | "DEGRADED" | "OUTAGE";
export type IncidentStatus = "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";
export type IncidentImpact = "MINOR" | "MAJOR" | "CRITICAL";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  settings?: {
    branding?: { primaryColor?: string; logoUrl?: string };
    slaOverrides?: Record<string, string>;
    allowedDomains?: string[];
    disabledRunbooks?: string[];
    autonomy?: AutonomyPolicy;
    verificationMinutes?: number;
    // Phase 11
    disabledPolicies?: string[];
    slackWebhookUrl?: string;
    briefSchedule?: string;
    githubRepo?: string;
    businessHours?: { tz?: string; daysOfWeek?: number[]; startHour?: number; endHour?: number };
  };
  createdAt?: string;
  suspendedAt?: string | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  authProvider?: AuthProvider;
  createdAt?: string;
  isPlatformAdmin?: boolean;
}

export interface Ticket {
  id: string;
  refCode: string;
  description: string;
  source: TicketSource;
  submitterName: string;
  submitterEmail: string;
  submitterUserId: string | null;
  assignedAgentId: string | null;
  assignedAgent?: { id: string; name: string; email: string } | null;
  submitter?: { id: string; name: string; email: string } | null;
  category: string;
  priority: string;
  assignedTeam: string;
  slaTarget: string;
  slaDueAt: string;
  slaAlertedAt: string | null;
  confidence: number;
  status: TicketStatus;
  autoReply: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments?: Attachment[];
  _count?: { comments: number; attachments: number };
}

export interface Comment {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: { id: string; name: string; email: string; role: Role };
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedById: string | null;
}

export type DiscoverySource = "MANUAL" | "AGENT";

export interface Device {
  id: string;
  hostname: string;
  assignedUser: string;
  type: DeviceType;
  os: string;
  healthStatus: HealthStatus;
  diskUsage: number;
  ramUsage: number;
  patchStatus: string;
  lastSeenAt: string;
  // Phase 7
  discoverySource: DiscoverySource;
  agentVersion: string | null;
  lastCheckInAt: string | null;
}

export interface DeviceMetric {
  recordedAt: string;
  cpu: number;
  ram: number;
  disk: number;
}

export interface AgentToken {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  /** Only present on the create response — the plain-text value. */
  token?: string;
}

export type RunbookRisk = "LOW" | "MEDIUM" | "HIGH";
export type RunbookStatus =
  | "RUNNING" | "SUCCEEDED" | "FAILED"
  | "AWAITING_USER" | "AWAITING_AGENT" | "AWAITING_VERIFICATION" | "CANCELLED";

export type AutonomyPolicy = "FULL_AUTO" | "REVIEW_MEDIUM_HIGH" | "HUMAN_IN_LOOP";

export interface BrainLogEntry {
  at: string;
  role: "system" | "assistant" | "tool";
  text: string;
}

export interface RunbookCatalogEntry {
  key: string;
  name: string;
  description: string;
  risk: RunbookRisk;
  disabled?: boolean;
}

export type AgentActionKind =
  | "RUN_DIAGNOSTIC" | "RESTART_SERVICE" | "CLEAR_CACHE"
  | "DISK_CLEANUP"  | "APPLY_PENDING_UPDATES";

export type AgentActionStatus =
  | "QUEUED" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "CANCELLED";

export interface AgentAction {
  id: string;
  kind: AgentActionKind;
  status: AgentActionStatus;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: string;
  dispatchedAt?: string | null;
  completedAt: string | null;
}

export interface RunbookExecution {
  id: string;
  ticketId: string;
  runbookKey: string;
  status: RunbookStatus;
  risk: RunbookRisk;
  confidence: number;
  startedAt: string;
  completedAt: string | null;
  verifyAt: string | null;
  brainLog: BrainLogEntry[];
  decision: Record<string, unknown> & {
    matchReason?: string;
    riskScore?: number;
    riskReasons?: string[];
    policy?: string | null;
    policyDecision?: "ALLOW" | "DENY";
    policyReason?: string;
  };
  approvedBy: { id: string; name: string; email: string } | null;
  agentActions?: AgentAction[];
}

export interface PolicyCatalogEntry {
  key: string;
  name: string;
  description: string;
  disabled?: boolean;
}

export interface DailyBriefStats {
  ticketsOpened: number;
  ticketsResolved: number;
  autoResolvedByBrain: number;
  slaBreached: number;
  devicesCritical: number;
  escalations: number;
  topRunbooks: Array<{ key: string; runs: number; succeeded: number; failed: number }>;
}

export interface DailyBrief {
  id: string;
  organizationId: string;
  forDate: string;
  markdown: string;
  stats: DailyBriefStats;
  createdAt: string;
}

// ─── Phase 12 — Detection ────────────────────────────────────────────

export type DetectionSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface DetectionRuleEntry {
  key: string;
  name: string;
  description: string;
  severity: DetectionSeverity;
  windowMinutes: number;
  disabled?: boolean;
}

export interface DetectionHit {
  id: string;
  organizationId: string;
  ruleKey: string;
  severity: DetectionSeverity;
  count: number;
  windowStart: string;
  windowEnd: string;
  evidence: Record<string, unknown>;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
}

// ─── Phase 13 — Workflows ────────────────────────────────────────────

export type WorkflowExecutionStatus =
  | "RUNNING" | "WAITING" | "AWAITING_APPROVAL"
  | "SUCCEEDED" | "FAILED" | "CANCELLED" | "COMPENSATING";

export type WorkflowStepStatus =
  | "PENDING" | "RUNNING" | "WAITING"
  | "SUCCEEDED" | "FAILED" | "SKIPPED" | "COMPENSATED";

export interface WorkflowCatalogEntry {
  key: string;
  name: string;
  description: string;
  stepCount: number;
}

export interface WorkflowStepExecution {
  id: string;
  workflowExecutionId: string;
  stepKey: string;
  sequence: number;
  status: WorkflowStepStatus;
  output: Record<string, unknown>;
  errorReason: string | null;
  resumeAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface WorkflowExecution {
  id: string;
  organizationId: string;
  ticketId: string;
  workflowKey: string;
  status: WorkflowExecutionStatus;
  currentStepKey: string | null;
  context: Record<string, unknown>;
  errorReason: string | null;
  startedAt: string;
  completedAt: string | null;
  steps?: WorkflowStepExecution[];
}

// ─── Phase 16 — ML models ────────────────────────────────────────────

export interface MlModelMetrics {
  sampleCount: number;
  positiveCount: number;
  negativeCount: number;
  accuracy: number;
  logLoss: number;
  epochs: number;
}

export interface MlModel {
  id: string;
  modelKey: string;
  version: number;
  active: boolean;
  metrics: MlModelMetrics;
  trainedAt: string;
}

// ─── Phase 25 — Threat intelligence ──────────────────────────────────

export type ThreatKind =
  | "CVE" | "KEV" | "IOC_IP" | "IOC_DOMAIN" | "IOC_HASH" | "NEWS" | "ADVISORY";

export type ThreatSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ThreatMatchStatus =
  | "OPEN" | "ACKNOWLEDGED" | "CONVERTED_TO_TICKET" | "DISMISSED";

export interface ThreatIntel {
  id: string;
  kind: ThreatKind;
  source: string;
  externalId: string;
  title: string;
  description: string;
  severity: ThreatSeverity;
  cvss: number | null;
  references: string[];
  affected: string[];
  kevMetadata: { knownRansomwareCampaignUse?: boolean; requiredAction?: string; dueDate?: string | null } | null;
  publishedAt: string;
  ingestedAt: string;
}

export interface ThreatMatch {
  id: string;
  organizationId: string;
  threatIntelId: string;
  threatIntel: ThreatIntel;
  reason: string;
  evidence: Record<string, unknown>;
  status: ThreatMatchStatus;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resultingTicketId: string | null;
  createdAt: string;
}

// ─── Phase 26 — Daily defender agent ─────────────────────────────────

export type DefenderStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "HALTED";

export type DefenderDecision =
  | { kind: "open_ticket"; matchId: string; ticketId: string; refCode: string; priority: string; reason: string }
  | { kind: "ack_match"; matchId: string; reason: string }
  | { kind: "dismiss_match"; matchId: string; reason: string }
  | { kind: "recommend_runbook"; matchId: string; runbookKey: string; reason: string }
  | { kind: "note"; text: string };

export interface DefenderToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  ts: string;
}

export interface DefenderOutcomes {
  defenderRunId?: string;
  decisionsMade?: number;
  ticketsOpened?: number;
  ticketsResolved?: number;
  ticketsStillOpen?: number;
  acksMade?: number;
  dismissalsMade?: number;
  dismissedThenRefired?: number;
}

export interface DefenderRun {
  id: string;
  organizationId?: string;
  runDate: string;
  status: DefenderStatus;
  situation: Record<string, unknown>;
  toolCalls?: DefenderToolCall[];
  decisions?: DefenderDecision[];
  briefing: string | null;
  iterations: number;
  errorReason: string | null;
  startedAt: string;
  completedAt: string | null;
  outcomesMeasuredAt: string | null;
  outcomes: DefenderOutcomes;
}

// ─── Phase 27 — Behavioural defence (MITRE ATT&CK + generated rules) ──

export interface AttackTechnique {
  id: string;
  mitreId: string;
  name: string;
  tactic: string;
  description: string;
  dataSources: string[];
  platforms: string[];
  revoked: boolean;
  modified: string;
}

export interface AttackCoverage {
  summary: { totalTechniques: number; approvedRules: number; coveredTechniques: number };
  byTactic: Record<string, {
    covered: number;
    total: number;
    techniques: Array<{ mitreId: string; name: string; covered: boolean }>;
  }>;
}

export type GeneratedRuleStatus = "DRAFT" | "TESTING" | "APPROVED" | "RETIRED" | "REJECTED";

export interface GeneratedRule {
  id: string;
  organizationId: string | null;
  attackTechniqueId: string | null;
  attackTechnique?: { mitreId: string; name: string; tactic: string } | null;
  title: string;
  description: string;
  severity: ThreatSeverity;
  logic: Record<string, unknown>;
  status: GeneratedRuleStatus;
  testResults: {
    samplesEvaluated?: number;
    matchingAlerts?: number;
    totalFires?: number;
    signalStrength?: number;
    topGroups?: Array<{ group: string; count: number }>;
  };
  createdBy: string;
  rationale: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface SensorAlertRow {
  id: string;
  organizationId: string;
  source: string;
  externalId: string;
  sourceRuleId: string;
  level: number;
  description: string;
  agentName: string | null;
  srcIp: string | null;
  dstIp: string | null;
  mitreTechniqueId: string | null;
  createdAt: string;
}

export interface RemoteSession {
  id: string;
  deviceId: string;
  agentId: string;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  eventLog: SessionEvent[];
  device?: Pick<Device, "id" | "hostname" | "assignedUser">;
  agent?: { id: string; name: string; email: string };
}
export interface SessionEvent { time: string; type: string; message: string }

export interface KbArticle {
  id: string;
  title: string;
  category: string;
  summary: string;
  steps: string[];
  keywords: string[];
  helpedCount: number;
  readMinutes: number;
}

export interface ServiceComponent {
  id: string;
  name: string;
  status: ComponentStatus;
  uptime90d: number;
}

export interface Incident {
  id: string;
  title: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  componentId: string;
  component?: { id: string; name: string };
  startedAt: string;
  resolvedAt: string | null;
  updates: Array<{ time: string; status: IncidentStatus; message: string }>;
}

export interface TriagePreview {
  category: string;
  priority: string;
  assignedTeam: string;
  slaTarget: string;
  confidence: number;
  matchedKeywords: string[];
}

export interface Analytics {
  organization?: Pick<Organization, "id" | "name" | "slug">;
  open: number;
  resolved: number;
  slaAtRisk: number;
  slaBreached: number;
  fleetHealthPct: number;
  kbDeflection: number;
  byCategory: Array<{ category: string; count: number }>;
  byPriority: Array<{ priority: string; count: number }>;
  fleet: Array<{ status: HealthStatus; count: number }>;
  csat: { average: number; responses: number; distribution: Array<{ rating: number | null; count: number }> };
}

export interface SurveyStatus {
  refCode: string;
  status: "PENDING" | "SUBMITTED";
  rating: number | null;
  comment: string | null;
  sentAt: string;
  submittedAt: string | null;
}

export interface StatusPagePayload {
  organization: Pick<Organization, "id" | "name" | "slug">;
  components: ServiceComponent[];
  activeIncidents: Incident[];
  recentHistory: Incident[];
}

export interface Invite {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface InviteLookup {
  email: string;
  role: Role;
  organization: { name: string; slug: string };
  expiresAt: string;
}

export interface PlatformOrgSummary extends Organization {
  _count: { users: number; tickets: number; devices: number };
}

export interface PlatformAnalytics {
  orgs: number;
  users: number;
  tickets: number;
  devices: number;
}
