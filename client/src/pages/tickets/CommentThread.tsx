import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ticketsApi } from "../../api/endpoints.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { Card } from "../../components/ui/Card.js";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { TextArea } from "../../components/ui/Field.js";
import { LoadingState } from "../../components/ui/EmptyState.js";
import { ApiError } from "../../api/client.js";

export function CommentThread({ ticketId }: { ticketId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isStaff = user?.role === "AGENT" || user?.role === "ADMIN";

  const { data, isLoading } = useQuery({
    queryKey: ["comments", ticketId],
    queryFn: () => ticketsApi.listComments(ticketId),
  });

  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => ticketsApi.addComment(ticketId, body.trim(), isInternal),
    onSuccess: () => {
      setBody(""); setIsInternal(false); setError(null);
      qc.invalidateQueries({ queryKey: ["comments", ticketId] });
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not post the comment.");
    },
  });

  return (
    <Card className="p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Conversation</p>
      <h3 className="font-display text-2xl mb-5">Comments</h3>

      {isLoading && <LoadingState />}

      {data && data.comments.length === 0 && (
        <p className="text-sm text-ink/60 mb-6">No comments yet — start the thread below.</p>
      )}

      {data && data.comments.length > 0 && (
        <ul className="space-y-4 mb-6">
          {data.comments.map((c) => (
            <li
              key={c.id}
              className={
                "rounded-2xl p-4 " +
                (c.isInternal ? "bg-amber-50 border border-amber-200" : "bg-paper border border-ink/10")
              }
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{c.author.name}</p>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-ink/50">{c.author.role}</span>
                  {c.isInternal && <Badge tone="warn">Internal</Badge>}
                </div>
                <p className="text-xs text-ink/50 font-mono">{new Date(c.createdAt).toLocaleString()}</p>
              </div>
              <p className="text-sm whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }} className="space-y-3">
        <TextArea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={isStaff ? "Write a reply…" : "Add a comment…"}
          rows={3}
          maxLength={5000}
        />
        {isStaff && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
            Internal note (only visible to agents and admins)
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={add.isPending || !body.trim()}>
          {add.isPending ? "Posting…" : "Post"}
        </Button>
      </form>
    </Card>
  );
}
