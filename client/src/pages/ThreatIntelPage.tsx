/**
 * Phase 25 — Threat Intelligence page.
 *
 * Two stacked cards:
 *   • Matches against this org's inventory (auto-correlated CVEs from
 *     the live feeds)
 *   • Recent intel feed across all sources (CISA KEV, NVD, GHSA, news)
 *
 * Admin can "Pull now" to force-poll all sources immediately.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { threatApi } from "../api/endpoints.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Button } from "../components/ui/Button.js";
import { Badge } from "../components/ui/Badge.js";
import { EmptyState, LoadingState } from "../components/ui/EmptyState.js";
import { useAuth } from "../auth/AuthProvider.js";
import type { ThreatKind, ThreatMatch, ThreatSeverity, ThreatIntel } from "../types.js";

const SEV_TONE: Record<ThreatSeverity, "neutral" | "info" | "warn" | "danger"> = {
  LOW: "neutral", MEDIUM: "info", HIGH: "warn", CRITICAL: "danger",
};

const KIND_LABEL: Record<ThreatKind, string> = {
  CVE: "CVE", KEV: "CISA KEV", IOC_IP: "IOC (IP)", IOC_DOMAIN: "IOC (domain)",
  IOC_HASH: "IOC (hash)", NEWS: "News", ADVISORY: "Advisory",
};

export default function ThreatIntelPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === "ADMIN";
  const isAgent = user?.role === "AGENT" || isAdmin;

  const [kindFilter, setKindFilter] = useState<ThreatKind | "ALL">("ALL");

  const matchesQ = useQuery({
    queryKey: ["threat", "matches"],
    queryFn: () => threatApi.listMatches("open"),
    refetchInterval: 60_000,
  });
  const intelQ = useQuery({
    queryKey: ["threat", "intel", kindFilter],
    queryFn: () => threatApi.listIntel(kindFilter === "ALL" ? undefined : kindFilter),
    refetchInterval: 60_000,
  });

  const ack = useMutation({
    mutationFn: (id: string) => threatApi.acknowledgeMatch(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threat"] }),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => threatApi.dismissMatch(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threat"] }),
  });
  const toTicket = useMutation({
    mutationFn: (id: string) => threatApi.convertToTicket(id, "High"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threat"] }),
  });
  const pullNow = useMutation({
    mutationFn: () => threatApi.ingest(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threat"] }),
  });

  return (
    <>
      <Header
        title="Threat intelligence"
        subtitle="Live feeds from CISA KEV, NVD, GitHub Security Advisories, and security news, auto-correlated against your fleet."
        action={isAdmin && (
          <Button size="sm" variant="secondary" loading={pullNow.isPending} onClick={() => pullNow.mutate()}>
            Pull now
          </Button>
        )}
      />

      {/* Matches against our inventory */}
      <Card className="p-6 mb-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Matches</p>
        <h3 className="font-display text-xl mb-4">Threats that hit your fleet</h3>
        {matchesQ.isLoading && <LoadingState />}
        {!matchesQ.isLoading && (matchesQ.data?.matches.length ?? 0) === 0 && (
          <EmptyState
            title="No open matches."
            description="When a new CVE drops that matches your devices, it'll appear here within minutes."
          />
        )}
        {(matchesQ.data?.matches ?? []).length > 0 && (
          <div className="space-y-3">
            {matchesQ.data!.matches.map((m) => (
              <MatchRow
                key={m.id}
                match={m}
                isAgent={isAgent}
                onAck={() => ack.mutate(m.id)}
                onDismiss={() => dismiss.mutate(m.id)}
                onTicket={() => toTicket.mutate(m.id)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Live feed */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">Feed</p>
            <h3 className="font-display text-xl">Recent intel</h3>
          </div>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as ThreatKind | "ALL")}
            className="text-xs border border-ink/15 rounded-full px-3 py-1"
          >
            <option value="ALL">All kinds</option>
            <option value="KEV">CISA KEV</option>
            <option value="CVE">CVE (NVD)</option>
            <option value="ADVISORY">Advisory (GHSA)</option>
            <option value="NEWS">News</option>
          </select>
        </div>

        {intelQ.isLoading && <LoadingState />}
        {!intelQ.isLoading && (intelQ.data?.intel.length ?? 0) === 0 && (
          <EmptyState title="No intel yet." description="The cron polls every 30 minutes; click 'Pull now' as an admin to force a fetch." />
        )}
        {(intelQ.data?.intel ?? []).length > 0 && (
          <div className="space-y-3">
            {intelQ.data!.intel.map((i) => <IntelRow key={i.id} intel={i} />)}
          </div>
        )}
      </Card>
    </>
  );
}

function MatchRow({ match, isAgent, onAck, onDismiss, onTicket }: {
  match: ThreatMatch;
  isAgent: boolean;
  onAck: () => void;
  onDismiss: () => void;
  onTicket: () => void;
}) {
  const intel = match.threatIntel;
  return (
    <div className="border border-ink/10 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge tone={SEV_TONE[intel.severity]}>{intel.severity}</Badge>
            <Badge tone="neutral">{KIND_LABEL[intel.kind]}</Badge>
            <span className="font-mono text-xs text-ink/60">{intel.externalId}</span>
            {intel.kevMetadata?.knownRansomwareCampaignUse && (
              <Badge tone="danger">RANSOMWARE</Badge>
            )}
          </div>
          <h4 className="font-display text-base truncate">{intel.title}</h4>
          <p className="text-sm text-ink/70 mt-1">{match.reason}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isAgent && (
            <Button size="sm" variant="primary" onClick={onTicket}>Open ticket</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onAck}>Ack</Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
        </div>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-ink/60 hover:text-ink">Evidence + references</summary>
        <pre className="mt-2 bg-ink/[0.03] rounded p-2 overflow-x-auto text-[11px]">{JSON.stringify(match.evidence, null, 2)}</pre>
        {intel.references.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {intel.references.map((r) => (
              <li key={r}><a href={r} target="_blank" rel="noreferrer" className="text-info-600 hover:underline break-all">{r}</a></li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function IntelRow({ intel }: { intel: ThreatIntel }) {
  return (
    <div className="border-b border-ink/5 pb-3 last:border-0">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <Badge tone={SEV_TONE[intel.severity]}>{intel.severity}</Badge>
        <Badge tone="neutral">{KIND_LABEL[intel.kind]}</Badge>
        <span className="font-mono text-[10px] text-ink/50">{intel.externalId}</span>
        {intel.cvss != null && <span className="font-mono text-[10px] text-ink/50">CVSS {intel.cvss.toFixed(1)}</span>}
        <span className="text-[10px] text-ink/40 ml-auto">{new Date(intel.publishedAt).toLocaleString()}</span>
      </div>
      <a
        href={intel.references[0] ?? "#"} target="_blank" rel="noreferrer"
        className="text-sm hover:underline"
      >
        {intel.title}
      </a>
      {intel.description && (
        <p className="text-xs text-ink/60 mt-1 line-clamp-2">{intel.description}</p>
      )}
    </div>
  );
}
