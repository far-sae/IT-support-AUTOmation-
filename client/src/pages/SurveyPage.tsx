import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { publicApi } from "../api/endpoints.js";
import { Card } from "../components/ui/Card.js";
import { Button } from "../components/ui/Button.js";
import { Field, TextArea } from "../components/ui/Field.js";
import { ErrorState, LoadingState } from "../components/ui/EmptyState.js";
import { ApiError } from "../api/client.js";
import { cx } from "../lib/cx.js";

export default function SurveyPage() {
  const { token = "" } = useParams<{ token: string }>();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["survey", token],
    queryFn: () => publicApi.surveyGet(token),
    enabled: Boolean(token),
    retry: false,
  });

  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () => publicApi.surveySubmit(token, rating!, comment.trim() || undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["survey", token] }),
    onError: (err) => setSubmitError(err instanceof ApiError ? err.message : "Could not submit."),
  });

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-6">
      <div className="w-full max-w-lg">
        <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">Relay · Satisfaction survey</p>

        {isLoading && <LoadingState />}
        {error && <ErrorState message={(error as Error).message} />}

        {data && (
          <Card className="p-8">
            <h1 className="font-display text-3xl mb-2">{data.refCode}</h1>
            <p className="text-ink/70 mb-6">
              {data.status === "SUBMITTED"
                ? "Thanks — your feedback's in. You rated this resolution:"
                : "How did we do on this ticket?"}
            </p>

            {data.status === "SUBMITTED" && (
              <div>
                <div className="flex gap-1 mb-4">
                  {[1,2,3,4,5].map(n => (
                    <span key={n} className={n <= (data.rating ?? 0) ? "text-ink" : "text-ink/15"}>
                      {n <= (data.rating ?? 0) ? "★" : "☆"}
                    </span>
                  ))}
                </div>
                {data.comment && <p className="text-sm text-ink/70 italic">"{data.comment}"</p>}
                <p className="text-xs text-ink/50 mt-6">Submitted {data.submittedAt && new Date(data.submittedAt).toLocaleString()}</p>
              </div>
            )}

            {data.status === "PENDING" && (
              <form onSubmit={(e) => { e.preventDefault(); if (rating) submit.mutate(); }} className="space-y-5">
                <div>
                  <p className="text-sm font-medium mb-2">Your rating</p>
                  <div className="flex gap-2">
                    {[1,2,3,4,5].map(n => (
                      <button
                        type="button"
                        key={n}
                        onClick={() => setRating(n)}
                        className={cx(
                          "h-12 w-12 rounded-full border text-xl",
                          rating !== null && n <= rating
                            ? "bg-ink text-lime border-ink"
                            : "border-ink/15 text-ink/40 hover:bg-ink/5",
                        )}
                        aria-label={`${n} stars`}
                      >
                        {rating !== null && n <= rating ? "★" : "☆"}
                      </button>
                    ))}
                  </div>
                </div>

                <Field label="Anything you'd add? (optional)">
                  <TextArea
                    value={comment} onChange={(e) => setComment(e.target.value)}
                    rows={4} maxLength={2000}
                    placeholder="What did we get right or wrong?"
                  />
                </Field>

                {submitError && <p className="text-sm text-red-600">{submitError}</p>}

                <Button type="submit" disabled={!rating || submit.isPending}>
                  {submit.isPending ? "Submitting…" : "Submit feedback"}
                </Button>
              </form>
            )}
          </Card>
        )}

        <p className="text-xs text-ink/50 mt-6 text-center">No login required · One-time link</p>
      </div>
    </div>
  );
}
