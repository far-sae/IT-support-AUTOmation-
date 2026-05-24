/**
 * Relay — multi-tenant database seed.
 *
 * Run with:  npm run seed         (dev, tsx)
 *            npm run seed:compiled (docker, after `tsc -p`)
 *
 * Creates three organizations:
 *   • Acme Corp           (slug: acme)   — full fleet + tickets + KB + incidents
 *   • Globex Industries   (slug: globex) — a smaller second tenant
 *   • Relay Platform      (slug: relay)  — hosts the platform-admin account
 *
 * Plus four logins (all password "relay1234"):
 *   admin@relay.io  agent@relay.io  employee@relay.io  (in Acme)
 *   platform@relay.io                                  (in Relay Platform)
 *   admin@globex.io agent@globex.io employee@globex.io (in Globex)
 *
 * Each tenant's writes are wrapped in `runWithTenant(orgId, ...)` so the
 * Prisma extension auto-injects `organizationId` on every operation — the
 * same code path real routes use.
 */

import { PrismaClient, Role, AuthProvider, TicketSource, TicketStatus,
  DeviceType, HealthStatus, ComponentStatus, IncidentStatus, IncidentImpact } from "@prisma/client";
import bcrypt from "bcrypt";

import { prisma as scoped } from "../src/db.js";
import { runWithTenant, runUnscoped } from "../src/tenant/context.js";
import { triage, generateAutoReply, computeSlaDueAt, type Priority } from "../src/triage.js";
import { decideAndExecute } from "../src/brain/index.js";

const raw = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────

async function reset() {
  // Postgres CASCADE on Organization FK deletes everything when we drop the
  // top-level orgs, so a single delete on Organization is enough.
  await raw.runbookExecution.deleteMany();
  await raw.surveyResponse.deleteMany();
  await raw.attachment.deleteMany();
  await raw.comment.deleteMany();
  await raw.ticket.deleteMany();
  await raw.deviceMetric.deleteMany();
  await raw.remoteSession.deleteMany();
  await raw.device.deleteMany();
  await raw.kbArticle.deleteMany();
  await raw.incident.deleteMany();
  await raw.serviceComponent.deleteMany();
  await raw.agentEnrollmentToken.deleteMany();
  await raw.user.deleteMany();
  await raw.orgInvite.deleteMany();
  await raw.organization.deleteMany();
}

interface OrgSeed {
  slug: string;
  name: string;
  users: { admin: string; agent: string; employee: string };
  devices: Array<{
    hostname: string; assignedUser: string; type: DeviceType; os: string;
    healthStatus: HealthStatus; diskUsage: number; ramUsage: number; patchStatus: string;
  }>;
  components: Array<{ name: string; status: ComponentStatus }>;
  kb: Array<{ title: string; category: string; summary: string; steps: string[]; keywords: string[]; helpedCount: number; readMinutes: number }>;
  tickets: Array<{ description: string; submitterName: string; submitterEmail: string; submitterUserKey?: "admin" | "agent" | "employee"; assignedAgentKey?: "agent" | "admin"; status: TicketStatus; source: TicketSource; comments?: Array<{ authorKey: "agent" | "admin" | "employee"; body: string; isInternal: boolean }> }>;
  incidents: Array<{ title: string; status: IncidentStatus; impact: IncidentImpact; componentName: string; daysAgo: number; resolved?: boolean; updates: Array<{ status: IncidentStatus; message: string; offsetHours: number }> }>;
}

const ACME: OrgSeed = {
  slug: "acme",
  name: "Acme Corp",
  users: { admin: "admin@relay.io", agent: "agent@relay.io", employee: "employee@relay.io" },
  devices: [
    { hostname: "MBP-AVERY-01",   assignedUser: "Avery Admin",     type: DeviceType.LAPTOP,  os: "macOS 14.5",      healthStatus: HealthStatus.HEALTHY,  diskUsage: 42, ramUsage: 38, patchStatus: "Up to date" },
    { hostname: "MBP-SAM-02",     assignedUser: "Sam Agent",       type: DeviceType.LAPTOP,  os: "macOS 14.4",      healthStatus: HealthStatus.HEALTHY,  diskUsage: 61, ramUsage: 55, patchStatus: "Up to date" },
    { hostname: "WIN-JORDAN-03",  assignedUser: "Jordan Employee", type: DeviceType.LAPTOP,  os: "Windows 11 23H2", healthStatus: HealthStatus.WARNING,  diskUsage: 88, ramUsage: 74, patchStatus: "2 updates pending" },
    { hostname: "WIN-PAYROLL-04", assignedUser: "Riya Patel",      type: DeviceType.DESKTOP, os: "Windows 11 22H2", healthStatus: HealthStatus.CRITICAL, diskUsage: 96, ramUsage: 91, patchStatus: "12 updates pending" },
    { hostname: "MBP-DESIGN-05",  assignedUser: "Léa Moreau",      type: DeviceType.LAPTOP,  os: "macOS 14.5",      healthStatus: HealthStatus.HEALTHY,  diskUsage: 55, ramUsage: 49, patchStatus: "Up to date" },
    { hostname: "WIN-FINANCE-06", assignedUser: "Marcus Cole",     type: DeviceType.DESKTOP, os: "Windows 10 22H2", healthStatus: HealthStatus.WARNING,  diskUsage: 71, ramUsage: 60, patchStatus: "End-of-life OS" },
    { hostname: "IPHONE-AVERY-07",assignedUser: "Avery Admin",     type: DeviceType.MOBILE,  os: "iOS 17.6",        healthStatus: HealthStatus.HEALTHY,  diskUsage: 38, ramUsage: 30, patchStatus: "Up to date" },
    { hostname: "ANDROID-SAM-08", assignedUser: "Sam Agent",       type: DeviceType.MOBILE,  os: "Android 14",      healthStatus: HealthStatus.HEALTHY,  diskUsage: 44, ramUsage: 33, patchStatus: "Up to date" },
  ],
  components: [
    { name: "Email",          status: ComponentStatus.OPERATIONAL },
    { name: "VPN",            status: ComponentStatus.OPERATIONAL },
    { name: "Single Sign-On", status: ComponentStatus.OPERATIONAL },
    { name: "File Storage",   status: ComponentStatus.DEGRADED },
    { name: "Chat (Slack)",   status: ComponentStatus.OPERATIONAL },
  ],
  kb: [
    { title: "Connecting to the corporate VPN",  category: "Network",          summary: "Step-by-step guide to install and connect to the Acme corporate VPN on macOS and Windows.", steps: ["Install the Acme VPN client from the self-service portal.", "Sign in with your corporate email and MFA.", "Choose the region closest to you.", "Click 'Connect' — the icon turns green when active.", "If it fails, restart the client and try again."], keywords: ["vpn", "wifi", "remote", "network", "connection"], readMinutes: 3, helpedCount: 142 },
    { title: "Resetting your password",          category: "Account & Access", summary: "Reset your Acme password yourself via the self-service portal — no ticket needed.", steps: ["Visit https://reset.acme.io.", "Enter your corporate email.", "Approve the MFA prompt on your phone.", "Choose a new password (12+ characters, mixed case, a number, a symbol).", "Sign back in to all your apps."], keywords: ["password", "reset", "login", "locked out", "mfa"], readMinutes: 2, helpedCount: 318 },
    { title: "Setting up MFA",                   category: "Account & Access", summary: "Enroll your phone in Microsoft Authenticator to sign in securely.", steps: ["Install Microsoft Authenticator on your phone.", "Visit https://mysignins.microsoft.com.", "Click 'Add sign-in method' → 'Authenticator app'.", "Scan the QR code with the app.", "Approve the test prompt."], keywords: ["mfa", "2fa", "authenticator", "security"], readMinutes: 4, helpedCount: 201 },
    { title: "Outlook calendar isn't syncing",   category: "Email",            summary: "Fix Outlook calendar sync issues on desktop and mobile in five minutes.", steps: ["File → Account Settings → Account Settings.", "Select your account → 'Repair'.", "Wait for the repair to complete (1-3 mins).", "Restart Outlook.", "If it still fails, sign out of Outlook and back in."], keywords: ["outlook", "email", "calendar", "exchange", "sync"], readMinutes: 3, helpedCount: 89 },
    { title: "Reporting a phishing email",       category: "Security",         summary: "How to use the 'Report phishing' button so the security team can act fast.", steps: ["Don't click any links in the suspicious email.", "Click the 'Report phishing' button in Outlook's ribbon.", "Confirm the report — the email is automatically forwarded to security.", "Delete the message from your inbox.", "If you already clicked something, raise a ticket immediately."], keywords: ["phishing", "phish", "security", "suspicious", "email"], readMinutes: 2, helpedCount: 174 },
    { title: "Requesting new software",          category: "Software",         summary: "Use the self-service catalog before raising a ticket for software requests.", steps: ["Open the Acme self-service portal.", "Search the software catalog for what you need.", "Click 'Request' — most apps install automatically.", "If your manager approval is required, you'll be notified.", "Need something not in the catalog? Raise a ticket."], keywords: ["software", "install", "application", "license", "request"], readMinutes: 2, helpedCount: 67 },
    { title: "Fixing a slow laptop",             category: "Hardware",         summary: "First-line fixes for a sluggish laptop — most are resolved by these four steps.", steps: ["Close apps you're not using (esp. browsers with 30+ tabs).", "Restart the laptop (yes, properly — Shut down, then power on).", "Check available disk space; clear Downloads if full.", "Install pending updates from the self-service portal."], keywords: ["laptop", "slow", "performance", "hardware", "restart"], readMinutes: 3, helpedCount: 156 },
    { title: "Joining the corporate Wi-Fi",      category: "Network",          summary: "How to connect personal and company laptops to Acme Wi-Fi.", steps: ["Pick the 'Acme-Corp' network.", "Sign in with your corporate email.", "Approve the MFA prompt.", "Accept the certificate (Acme-Corp-CA).", "You're online — bookmark acme.io/intranet."], keywords: ["wifi", "wi-fi", "network", "corporate", "connect"], readMinutes: 2, helpedCount: 98 },
  ],
  tickets: [
    { description: "I can't connect to the VPN from home — it just hangs on 'connecting'. WiFi is fine.",                              submitterName: "Jordan Employee", submitterEmail: "employee@relay.io", submitterUserKey: "employee", assignedAgentKey: "agent", status: TicketStatus.IN_PROGRESS, source: TicketSource.PORTAL, comments: [
      { authorKey: "agent", body: "Hi Jordan — could you try restarting the VPN client and letting me know if the error changes?", isInternal: false },
      { authorKey: "agent", body: "Note: this is the third VPN report this morning — checking if it's a regional issue.", isInternal: true },
    ]},
    { description: "My laptop battery is dead and the charger isn't doing anything — it won't turn on.",                                submitterName: "Riya Patel",      submitterEmail: "riya@acme.io",   status: TicketStatus.OPEN,        source: TicketSource.EMAIL },
    { description: "I'm locked out of my account, MFA reset isn't working and I have a deadline today.",                              submitterName: "Marcus Cole",     submitterEmail: "marcus@acme.io", assignedAgentKey: "agent", status: TicketStatus.OPEN, source: TicketSource.PORTAL },
    { description: "Outlook calendar invites aren't syncing — meetings keep disappearing from my mailbox.",                           submitterName: "Léa Moreau",      submitterEmail: "lea@acme.io",    assignedAgentKey: "agent", status: TicketStatus.RESOLVED, source: TicketSource.PORTAL, comments: [
      { authorKey: "agent", body: "Repaired your Outlook profile — let me know if invites stop showing again.", isInternal: false },
    ]},
    { description: "Got a suspicious phishing email asking me to confirm my password — pretty sure my coworker's account is compromised.", submitterName: "Jordan Employee", submitterEmail: "employee@relay.io", submitterUserKey: "employee", assignedAgentKey: "agent", status: TicketStatus.IN_PROGRESS, source: TicketSource.PORTAL, comments: [
      { authorKey: "agent", body: "Security team is investigating — please don't click any links in that email.", isInternal: false },
    ]},
    { description: "Question — how do I install Slack on my new laptop? No rush, whenever you get a chance.",                         submitterName: "Jordan Employee", submitterEmail: "employee@relay.io", submitterUserKey: "employee", status: TicketStatus.OPEN, source: TicketSource.PORTAL },
  ],
  incidents: [
    { title: "File storage — elevated upload latency", status: IncidentStatus.MONITORING, impact: IncidentImpact.MINOR, componentName: "File Storage",   daysAgo: 0, updates: [
      { status: IncidentStatus.INVESTIGATING, message: "We're seeing slower-than-usual upload times on the file storage service.", offsetHours: -3 },
      { status: IncidentStatus.IDENTIFIED,    message: "Identified a hot shard in the storage backend. Failing over.",              offsetHours: -2 },
      { status: IncidentStatus.MONITORING,    message: "Failover complete. Latency back to normal — monitoring.",                    offsetHours: -0.5 },
    ]},
    { title: "SSO — sign-in failures", status: IncidentStatus.RESOLVED, impact: IncidentImpact.MAJOR, componentName: "Single Sign-On", daysAgo: 7, resolved: true, updates: [
      { status: IncidentStatus.INVESTIGATING, message: "SSO sign-ins are failing for a subset of users.",                        offsetHours: 0 },
      { status: IncidentStatus.IDENTIFIED,    message: "Identity provider returned 503s. Restarting the auth pool.",             offsetHours: 0.5 },
      { status: IncidentStatus.RESOLVED,      message: "Sign-ins are back to normal. Incident resolved.",                        offsetHours: 1.5 },
    ]},
  ],
};

const GLOBEX: OrgSeed = {
  slug: "globex",
  name: "Globex Industries",
  users: { admin: "admin@globex.io", agent: "agent@globex.io", employee: "employee@globex.io" },
  devices: [
    { hostname: "GLBX-LAPTOP-01", assignedUser: "Hank Scorpio",    type: DeviceType.LAPTOP,  os: "macOS 14.5",      healthStatus: HealthStatus.HEALTHY,  diskUsage: 35, ramUsage: 42, patchStatus: "Up to date" },
    { hostname: "GLBX-LAPTOP-02", assignedUser: "Frank Grimes",    type: DeviceType.LAPTOP,  os: "Windows 11 23H2", healthStatus: HealthStatus.WARNING,  diskUsage: 78, ramUsage: 81, patchStatus: "5 updates pending" },
    { hostname: "GLBX-DESK-03",   assignedUser: "Lindsay Naegle",  type: DeviceType.DESKTOP, os: "Ubuntu 24.04",    healthStatus: HealthStatus.HEALTHY,  diskUsage: 22, ramUsage: 30, patchStatus: "Up to date" },
    { hostname: "GLBX-PHONE-04",  assignedUser: "Hank Scorpio",    type: DeviceType.MOBILE,  os: "iOS 17.5",        healthStatus: HealthStatus.HEALTHY,  diskUsage: 60, ramUsage: 45, patchStatus: "Up to date" },
  ],
  components: [
    { name: "Email",         status: ComponentStatus.OPERATIONAL },
    { name: "VPN",           status: ComponentStatus.OPERATIONAL },
    { name: "ERP",           status: ComponentStatus.OPERATIONAL },
    { name: "Time Tracking", status: ComponentStatus.OUTAGE },
  ],
  kb: [
    { title: "Logging into the ERP",       category: "Software",         summary: "How to access the Globex ERP from a managed device.",          steps: ["Open the ERP shortcut.", "Sign in with your Globex SSO.", "Pick the correct cost centre.", "Lock the session when you step away."], keywords: ["erp", "software", "login"], readMinutes: 3, helpedCount: 51 },
    { title: "Requesting a new VPN profile", category: "Network",        summary: "Request a region-specific VPN profile from the network team.", steps: ["Open a ticket with category Network.", "Specify the region.", "We'll provision and email you the profile."], keywords: ["vpn", "network", "request"], readMinutes: 2, helpedCount: 22 },
    { title: "Globex MFA enrollment",      category: "Account & Access", summary: "Multi-factor authentication is mandatory at Globex.",          steps: ["Download Authenticator.", "Visit mysignins.globex.io.", "Scan the QR code.", "Test the prompt."], keywords: ["mfa", "2fa", "globex"], readMinutes: 3, helpedCount: 67 },
  ],
  tickets: [
    { description: "Time Tracking is down — none of the team can submit hours today, urgent.",                                       submitterName: "Hank Scorpio",  submitterEmail: "admin@globex.io",  submitterUserKey: "admin",    assignedAgentKey: "agent", status: TicketStatus.IN_PROGRESS, source: TicketSource.PORTAL },
    { description: "VPN drops every 10 minutes — only on the Madrid office subnet.",                                                  submitterName: "Lindsay Naegle",submitterEmail: "employee@globex.io",submitterUserKey: "employee", assignedAgentKey: "agent", status: TicketStatus.OPEN, source: TicketSource.PORTAL },
    { description: "Need Photoshop installed on my new Ubuntu workstation.",                                                          submitterName: "Frank Grimes", submitterEmail: "agent@globex.io",  submitterUserKey: "agent",    status: TicketStatus.OPEN, source: TicketSource.PORTAL },
    { description: "MFA prompt loop — Authenticator says approved but the page keeps refreshing.",                                    submitterName: "Hank Scorpio",  submitterEmail: "admin@globex.io",  submitterUserKey: "admin",    assignedAgentKey: "agent", status: TicketStatus.RESOLVED, source: TicketSource.PORTAL },
  ],
  incidents: [
    { title: "Time Tracking — outage", status: IncidentStatus.INVESTIGATING, impact: IncidentImpact.CRITICAL, componentName: "Time Tracking", daysAgo: 0, updates: [
      { status: IncidentStatus.INVESTIGATING, message: "Time Tracking is unreachable — investigating with the vendor.", offsetHours: -1 },
    ]},
  ],
};

let refCounters: Record<string, number> = {};
function nextRef(slug: string): string {
  refCounters[slug] = (refCounters[slug] ?? 1041) + 1;
  return `INC-${refCounters[slug]}`;
}

async function seedOrg(seed: OrgSeed, passwordHash: string) {
  console.log(`\n🌱 ${seed.name} (slug=${seed.slug})…`);
  const org = await raw.organization.create({
    data: { name: seed.name, slug: seed.slug },
  });

  return runWithTenant(org.id, async () => {
    const usersByKey: Record<"admin" | "agent" | "employee", string> = await (async () => {
      const admin = await scoped.user.create({
        data: {
          organizationId: org.id,
          name: seed.name === "Acme Corp" ? "Avery Admin" : "Hank Scorpio",
          email: seed.users.admin,
          passwordHash,
          authProvider: AuthProvider.LOCAL,
          role: Role.ADMIN,
        },
      });
      const agent = await scoped.user.create({
        data: {
          organizationId: org.id,
          name: seed.name === "Acme Corp" ? "Sam Agent" : "Frank Grimes",
          email: seed.users.agent,
          passwordHash,
          authProvider: AuthProvider.LOCAL,
          role: Role.AGENT,
        },
      });
      const employee = await scoped.user.create({
        data: {
          organizationId: org.id,
          name: seed.name === "Acme Corp" ? "Jordan Employee" : "Lindsay Naegle",
          email: seed.users.employee,
          passwordHash,
          authProvider: AuthProvider.LOCAL,
          role: Role.EMPLOYEE,
        },
      });
      return { admin: admin.id, agent: agent.id, employee: employee.id };
    })();

    // First two devices in each org get the AGENT discovery source +
    // a 24-hour CPU/RAM/disk history so the sparklines have data on first
    // load. The remaining devices stay MANUAL.
    const createdDevices: Array<{ id: string; agentBacked: boolean; baseline: { cpu: number; ram: number; disk: number } }> = [];
    for (let i = 0; i < seed.devices.length; i += 1) {
      const d = seed.devices[i]!;
      const agentBacked = i < 2;
      const device = await scoped.device.create({
        data: {
          ...d,
          organizationId: org.id,
          discoverySource: agentBacked ? "AGENT" : "MANUAL",
          agentVersion: agentBacked ? "0.1.0" : null,
          lastCheckInAt: agentBacked ? new Date() : null,
        },
      });
      createdDevices.push({
        id: device.id,
        agentBacked,
        baseline: { cpu: 25 + Math.round(Math.random() * 20), ram: d.ramUsage, disk: d.diskUsage },
      });
    }

    // 24-hour metric history at 30-minute resolution for agent-backed devices.
    const now = Date.now();
    for (const cd of createdDevices) {
      if (!cd.agentBacked) continue;
      const samples: Array<{ recordedAt: Date; cpu: number; ram: number; disk: number }> = [];
      for (let h = 48; h >= 0; h -= 1) {
        const drift = Math.sin(h / 4) * 10;
        samples.push({
          recordedAt: new Date(now - h * 30 * 60 * 1000),
          cpu: Math.max(2, Math.min(98, Math.round(cd.baseline.cpu + drift + (Math.random() * 8 - 4)))),
          ram: Math.max(10, Math.min(98, Math.round(cd.baseline.ram + drift / 2 + (Math.random() * 6 - 3)))),
          disk: Math.max(10, Math.min(98, Math.round(cd.baseline.disk + (Math.random() * 2 - 1)))),
        });
      }
      for (const s of samples) {
        await scoped.deviceMetric.create({
          data: { organizationId: org.id, deviceId: cd.id, ...s },
        });
      }
    }

    // One demo agent enrollment token per non-platform org.
    await scoped.agentEnrollmentToken.create({
      data: {
        organizationId: org.id,
        label: "Demo · all devices",
        token: `relay_agent_demo_${seed.slug}_${Math.random().toString(36).slice(2, 14)}`,
      },
    });

    for (const a of seed.kb) {
      await scoped.kbArticle.create({
        data: {
          organizationId: org.id,
          title: a.title,
          category: a.category,
          summary: a.summary,
          steps: a.steps,
          keywords: a.keywords,
          helpedCount: a.helpedCount,
          readMinutes: a.readMinutes,
        },
      });
    }

    const componentsByName = new Map<string, string>();
    for (const c of seed.components) {
      const comp = await scoped.serviceComponent.create({
        data: { organizationId: org.id, name: c.name, status: c.status },
      });
      componentsByName.set(c.name, comp.id);
    }

    for (const inc of seed.incidents) {
      const componentId = componentsByName.get(inc.componentName);
      if (!componentId) continue;
      const startedAt = new Date(Date.now() - inc.daysAgo * 24 * 60 * 60 * 1000);
      const updates = inc.updates.map((u) => ({
        time: new Date(startedAt.getTime() + u.offsetHours * 60 * 60 * 1000).toISOString(),
        status: u.status,
        message: u.message,
      }));
      const resolvedAt = inc.resolved
        ? new Date(startedAt.getTime() + (inc.updates[inc.updates.length - 1]?.offsetHours ?? 0) * 60 * 60 * 1000)
        : null;
      await scoped.incident.create({
        data: {
          organizationId: org.id,
          title: inc.title,
          status: inc.status,
          impact: inc.impact,
          componentId,
          startedAt,
          resolvedAt,
          updates: updates as unknown as object,
        },
      });
    }

    for (const t of seed.tickets) {
      const result = triage(t.description);
      const refCode = nextRef(seed.slug);
      const createdAt = new Date(Date.now() - Math.floor(Math.random() * 4 * 24 * 60 * 60 * 1000));
      const slaDueAt = computeSlaDueAt(result.priority as Priority, createdAt);
      const autoReply = generateAutoReply({
        submitterName: t.submitterName,
        refCode,
        category: result.category,
        priority: result.priority,
        assignedTeam: result.assignedTeam,
        slaTarget: result.slaTarget,
      });

      const ticket = await scoped.ticket.create({
        data: {
          organizationId: org.id,
          refCode,
          description: t.description,
          source: t.source,
          submitterName: t.submitterName,
          submitterEmail: t.submitterEmail,
          submitterUserId: t.submitterUserKey ? usersByKey[t.submitterUserKey] : null,
          assignedAgentId: t.assignedAgentKey ? usersByKey[t.assignedAgentKey] : null,
          category: result.category,
          priority: result.priority,
          assignedTeam: result.assignedTeam,
          slaTarget: result.slaTarget,
          slaDueAt,
          confidence: result.confidence,
          status: t.status,
          autoReply,
          createdAt,
          resolvedAt: t.status === TicketStatus.RESOLVED ? new Date(createdAt.getTime() + 6 * 60 * 60 * 1000) : null,
        },
      });

      if (t.comments) {
        for (const c of t.comments) {
          await scoped.comment.create({
            data: {
              organizationId: org.id,
              ticketId: ticket.id,
              authorId: usersByKey[c.authorKey],
              body: c.body,
              isInternal: c.isInternal,
            },
          });
        }
      }
    }

    // ── Phase 10A demo: one ticket per org that runs through the auto-
    // remediation engine end-to-end, so the seeded DB shows real runbook
    // activity (a SUCCEEDED password_reset that closed its own ticket).
    {
      const description = "I forgot my password and need it reset, thanks!";
      const result = triage(description);
      const refCode = nextRef(seed.slug);
      const slaDueAt = computeSlaDueAt(result.priority as Priority, new Date());
      const autoReply = generateAutoReply({
        submitterName: seed.name === "Acme Corp" ? "Jordan Employee" : "Lindsay Naegle",
        refCode,
        category: result.category, priority: result.priority,
        assignedTeam: result.assignedTeam, slaTarget: result.slaTarget,
      });
      const demoTicket = await scoped.ticket.create({
        data: {
          organizationId: org.id, refCode, description,
          source: TicketSource.PORTAL,
          submitterName: seed.name === "Acme Corp" ? "Jordan Employee" : "Lindsay Naegle",
          submitterEmail: seed.users.employee,
          submitterUserId: usersByKey.employee,
          category: result.category, priority: result.priority,
          assignedTeam: result.assignedTeam, slaTarget: result.slaTarget,
          slaDueAt, confidence: result.confidence,
          status: TicketStatus.OPEN, autoReply,
        },
      });
      await decideAndExecute(demoTicket, result);
    }
  });
}

async function seedRelayPlatform(passwordHash: string) {
  console.log(`\n🌱 Relay Platform (slug=relay) — platform admin home org…`);
  const org = await raw.organization.create({
    data: { name: "Relay Platform", slug: "relay" },
  });
  await runUnscoped(async () => {
    await raw.user.create({
      data: {
        organizationId: org.id,
        name: "Relay Platform Admin",
        email: "platform@relay.io",
        passwordHash,
        authProvider: AuthProvider.LOCAL,
        role: Role.ADMIN,
        isPlatformAdmin: true,
      },
    });
  });
}

async function main() {
  console.log("🌱 Resetting…");
  await reset();
  refCounters = {};

  const passwordHash = await bcrypt.hash("relay1234", 10);

  await seedRelayPlatform(passwordHash);
  await seedOrg(ACME, passwordHash);
  await seedOrg(GLOBEX, passwordHash);

  console.log("\n✅ Seed complete.");
  console.log("");
  console.log("Seeded logins (all password 'relay1234'):");
  console.log("  PLATFORM      platform@relay.io       (Relay Platform)");
  console.log("  ACME · ADMIN  admin@relay.io");
  console.log("  ACME · AGENT  agent@relay.io");
  console.log("  ACME · EMPL.  employee@relay.io");
  console.log("  GLOBEX · ADMIN admin@globex.io");
  console.log("  GLOBEX · AGENT agent@globex.io");
  console.log("  GLOBEX · EMPL. employee@globex.io");
}

main()
  .catch((err) => { console.error("❌ Seed failed:", err); process.exit(1); })
  .finally(async () => {
    await raw.$disconnect();
  });
