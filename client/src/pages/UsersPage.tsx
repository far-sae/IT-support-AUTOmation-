import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { usersApi } from "../api/endpoints.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Field, Select, TextInput } from "../components/ui/Field.js";
import { ErrorState, LoadingState } from "../components/ui/EmptyState.js";
import { ApiError } from "../api/client.js";
import type { Role, User } from "../types.js";

export default function UsersPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersApi.list(),
  });

  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [password, setPassword] = useState(""); const [role, setRole] = useState<Role>("EMPLOYEE");
  const [createError, setCreateError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => usersApi.create({ name, email, password, role }),
    onSuccess: () => {
      setName(""); setEmail(""); setPassword(""); setRole("EMPLOYEE"); setShowNew(false); setCreateError(null);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => setCreateError(err instanceof ApiError ? err.message : "Could not create user."),
  });

  const patch = useMutation({
    mutationFn: (input: { id: string; role: Role }) => usersApi.patch(input.id, { role: input.role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <>
      <Header
        title="Users"
        subtitle="Add agents, promote admins, demote when people change roles."
        action={
          <Button variant={showNew ? "secondary" : "primary"} onClick={() => setShowNew(s => !s)}>
            {showNew ? "Cancel" : "New user"}
          </Button>
        }
      />

      {showNew && (
        <Card className="p-6 mb-6">
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="Email"><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="Password"><TextInput type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></Field>
            <Field label="Role">
              <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="EMPLOYEE">Employee</option>
                <option value="AGENT">Agent</option>
                <option value="ADMIN">Admin</option>
              </Select>
            </Field>
            {createError && <p className="md:col-span-4 text-sm text-red-600">{createError}</p>}
            <div className="md:col-span-4">
              <Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create user"}</Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-left text-ink/60 font-mono text-[10px] uppercase tracking-widest">
              <tr className="border-b border-ink/10">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3">Auth</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u: User) => (
                <tr key={u.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-6 py-3 font-medium">{u.name}</td>
                  <td className="px-6 py-3 text-ink/70">{u.email}</td>
                  <td className="px-6 py-3">
                    <Select
                      value={u.role}
                      onChange={(e) => patch.mutate({ id: u.id, role: e.target.value as Role })}
                      className="max-w-[140px]"
                    >
                      <option value="EMPLOYEE">Employee</option>
                      <option value="AGENT">Agent</option>
                      <option value="ADMIN">Admin</option>
                    </Select>
                  </td>
                  <td className="px-6 py-3"><Badge tone="neutral">{u.authProvider ?? "LOCAL"}</Badge></td>
                  <td className="px-6 py-3 text-right">
                    <Button
                      variant="danger" size="sm"
                      onClick={() => {
                        if (window.confirm(`Delete ${u.name}?`)) remove.mutate(u.id);
                      }}
                    >Delete</Button>
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
