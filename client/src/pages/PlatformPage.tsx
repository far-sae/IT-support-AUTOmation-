import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { platformApi } from "../api/endpoints.js";
import { ApiError } from "../api/client.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Field, TextInput } from "../components/ui/Field.js";
import { ErrorState, LoadingState } from "../components/ui/EmptyState.js";

export default function PlatformPage() {
  const qc = useQueryClient();

  const orgsQ = useQuery({
    queryKey: ["platform", "orgs"],
    queryFn: () => platformApi.listOrganizations(),
  });
  const aggQ = useQuery({
    queryKey: ["platform", "analytics"],
    queryFn: () => platformApi.analytics(),
  });

  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => platformApi.createOrganization(name, slug.trim() || undefined),
    onSuccess: () => {
      setName(""); setSlug(""); setShowNew(false); setCreateError(null);
      qc.invalidateQueries({ queryKey: ["platform"] });
    },
    onError: (err) => setCreateError(err instanceof ApiError ? err.message : "Could not create org."),
  });

  const suspend = useMutation({
    mutationFn: (input: { id: string; suspend: boolean }) => platformApi.setSuspended(input.id, input.suspend),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform", "orgs"] }),
  });

  function submitCreate(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <>
      <Header
        title="Platform"
        subtitle="Manage tenants and see cross-org usage."
        action={
          <Button variant={showNew ? "secondary" : "primary"} onClick={() => setShowNew(s => !s)}>
            {showNew ? "Cancel" : "New organization"}
          </Button>
        }
      />

      {/* Aggregate */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card className="p-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">Organizations</p>
          <p className="font-display text-4xl mt-2">{aggQ.data?.orgs ?? "—"}</p>
        </Card>
        <Card className="p-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">Users</p>
          <p className="font-display text-4xl mt-2">{aggQ.data?.users ?? "—"}</p>
        </Card>
        <Card className="p-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">Tickets</p>
          <p className="font-display text-4xl mt-2">{aggQ.data?.tickets ?? "—"}</p>
        </Card>
        <Card className="p-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">Devices</p>
          <p className="font-display text-4xl mt-2">{aggQ.data?.devices ?? "—"}</p>
        </Card>
      </div>

      {/* New org */}
      {showNew && (
        <Card className="p-6 mb-6">
          <form onSubmit={submitCreate} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Name">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Slug" hint="Optional — derived from name">
              <TextInput value={slug} onChange={(e) => setSlug(e.target.value)} className="font-mono" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={create.isPending || !name.trim()}>
                {create.isPending ? "Creating…" : "Create"}
              </Button>
            </div>
            {createError && <p className="md:col-span-3 text-sm text-red-600">{createError}</p>}
          </form>
        </Card>
      )}

      {/* Org list */}
      {orgsQ.isLoading && <LoadingState />}
      {orgsQ.error && <ErrorState message={(orgsQ.error as Error).message} />}

      {orgsQ.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-left text-ink/60 font-mono text-[10px] uppercase tracking-widest">
              <tr className="border-b border-ink/10">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Slug</th>
                <th className="px-6 py-3">Users / Tickets / Devices</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orgsQ.data.organizations.map((o) => (
                <tr key={o.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-6 py-3 font-medium">{o.name}</td>
                  <td className="px-6 py-3 font-mono text-xs text-ink/70">{o.slug}</td>
                  <td className="px-6 py-3 font-mono text-xs text-ink/70">
                    {o._count.users} · {o._count.tickets} · {o._count.devices}
                  </td>
                  <td className="px-6 py-3">
                    {o.suspendedAt
                      ? <Badge tone="danger">Suspended</Badge>
                      : <Badge tone="success">Active</Badge>}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Button
                      variant="secondary" size="sm"
                      onClick={() => suspend.mutate({ id: o.id, suspend: !o.suspendedAt })}
                      disabled={suspend.isPending}
                    >
                      {o.suspendedAt ? "Unsuspend" : "Suspend"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
