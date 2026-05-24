import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { kbApi } from "../api/endpoints.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Badge } from "../components/ui/Badge.js";
import { ErrorState, LoadingState, EmptyState } from "../components/ui/EmptyState.js";

export default function KnowledgePage() {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["kb", q],
    queryFn: () => kbApi.search(q),
  });

  return (
    <>
      <Header title="Knowledge base" subtitle="Self-service answers for the common stuff." />

      <input
        value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Try: vpn, password reset, outlook calendar…"
        className="w-full rounded-2xl border border-ink/15 bg-white px-5 py-4 text-base focus:outline-none focus:ring-2 focus:ring-ink/20 mb-6"
      />

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {data && data.articles.length === 0 && (
        <EmptyState title="No articles match that search" description="Try a broader phrase, or raise a ticket." />
      )}

      {data && data.articles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.articles.map(a => {
            const open = expanded === a.id;
            return (
              <Card key={a.id} className="p-6">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <Badge tone="info">{a.category}</Badge>
                  <span className="font-mono text-xs text-ink/60">{a.readMinutes} min read</span>
                </div>
                <h3 className="font-display text-xl mb-2">{a.title}</h3>
                <p className="text-sm text-ink/70 mb-3">{a.summary}</p>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : a.id)}
                  className="text-sm underline underline-offset-4 text-ink/80 hover:text-ink"
                >
                  {open ? "Hide steps" : "See steps"}
                </button>
                {open && (
                  <ol className="mt-4 space-y-2 list-decimal list-inside text-sm">
                    {a.steps.map((step, i) => <li key={i}>{step}</li>)}
                  </ol>
                )}
                <p className="font-mono text-[10px] text-ink/50 mt-4">{a.helpedCount} people found this helpful</p>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
