import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Cloud,
  Database,
  ExternalLink,
  FolderOpen,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Table2,
  Trash2,
  Users,
} from "lucide-react";
import { confirmDialog, promptDialog } from "@/components/AppDialogs";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  CLOUD_ACCESS,
  CLOUD_COLUMN_TYPES,
  type CloudAccess,
  type CloudStatus,
  type CloudTableDef,
} from "@/lib/cloud-core";
import type { CloudAction, CloudResult } from "@/lib/cloud.functions";

type Section = "database" | "users" | "files" | "connection";
type ColumnType = CloudTableDef["columns"][number]["type"];

interface CloudPanelProps {
  projectId: string;
  status: CloudStatus | null;
  run: (action: CloudAction) => Promise<CloudResult>;
}

const ACCESS_LABEL: Record<CloudAccess, string> = {
  public: "Anyone",
  authenticated: "Signed-in users",
  owner: "Only the creator",
};
const SECTIONS: Array<{ id: Section; label: string; icon: typeof Database }> = [
  { id: "database", label: "Database", icon: Table2 },
  { id: "users", label: "Users", icon: Users },
  { id: "files", label: "Storage", icon: FolderOpen },
  { id: "connection", label: "Connection", icon: Plug },
];
const fieldBase =
  "h-8 rounded-lg border border-border bg-background px-2.5 text-xs outline-none focus:border-primary";
const field = `${fieldBase} w-full`;
const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
const show = (value: unknown) =>
  value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);

function parseValue(type: ColumnType, text: string): unknown {
  if (text === "") return null;
  if (type === "number") {
    const number = Number(text);
    if (Number.isNaN(number)) throw new Error(`"${text}" is not a number`);
    return number;
  }
  if (type === "boolean") return text === "true";
  if (type === "json") return JSON.parse(text);
  return text;
}

export function CloudPanel({ projectId, status, run }: CloudPanelProps) {
  const [section, setSection] = useState<Section>("database");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [rows, setRows] = useState<NonNullable<CloudResult["rows"]>>([]);
  const [users, setUsers] = useState<NonNullable<CloudResult["users"]>>([]);
  const [files, setFiles] = useState<NonNullable<CloudResult["files"]>>([]);
  const [draft, setDraft] = useState<{ id: string; values: Record<string, string> } | null>(null);
  const [newColumn, setNewColumn] = useState<{ name: string; type: ColumnType }>({
    name: "",
    type: "text",
  });
  const [link, setLink] = useState({ url: "", key: "" });

  const act = useCallback(
    async (action: CloudAction, done?: string) => {
      setBusy(true);
      try {
        const result = await run(action);
        if (result.rows) setRows(result.rows);
        if (result.users) setUsers(result.users);
        if (result.files) setFiles(result.files);
        if (done) toast.success(done);
        return result;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Cloud request failed");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [run],
  );

  const enabled = Boolean(status?.enabled);
  const ownSupabase = status?.backend === "supabase";
  const tables = useMemo(() => status?.tables ?? [], [status]);
  const table = tables.find((item) => item.name === selected) ?? tables[0];
  const tableName = table?.name ?? "";

  useEffect(() => {
    if (status?.supabaseUrl) setLink((current) => ({ ...current, url: status.supabaseUrl }));
  }, [status?.supabaseUrl]);

  useEffect(() => {
    setDraft(null);
    if (!enabled || ownSupabase || !projectId) return;
    if (section === "database" && tableName) void act({ action: "rows", table: tableName });
    if (section === "users") void act({ action: "users" });
    if (section === "files") void act({ action: "files" });
  }, [section, tableName, enabled, ownSupabase, projectId, act]);

  const saveTable = (next: Partial<CloudTableDef>, done: string) => {
    if (!table) return;
    const { rows: _count, ...definition } = table;
    void act({ action: "applySchema", tables: [{ ...definition, ...next }] }, done);
  };
  const columns = table?.columns ?? [];
  const extraKeys = useMemo(() => {
    const known = new Set(columns.map((column) => column.name));
    return Array.from(new Set(rows.flatMap((row) => Object.keys(row.data)))).filter(
      (key) => !known.has(key),
    );
  }, [rows, columns]);

  const saveDraft = () => {
    if (!draft || !table) return;
    try {
      const data: Record<string, unknown> = {};
      for (const column of columns) {
        const value = parseValue(column.type, draft.values[column.name] ?? "");
        if (value !== null) data[column.name] = value;
      }
      const previous = rows.find((row) => row.id === draft.id)?.data ?? {};
      for (const key of extraKeys) if (key in previous) data[key] = previous[key];
      void act(
        { action: "saveRow", table: table.name, data, ...(draft.id ? { id: draft.id } : {}) },
        "Record saved",
      ).then((result) => result && setDraft(null));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid value");
    }
  };

  if (!enabled) {
    return (
      <div className="thin-scroll flex flex-1 flex-col items-center justify-center overflow-y-auto p-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-accent-soft text-primary shadow-glow">
          <Cloud className="size-7" />
        </span>
        <h2 className="mt-5 text-xl font-semibold tracking-tight">Cloud Codzer</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          A real backend for this project: a database, user accounts and file storage that your app
          can use right away. Nothing to install.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            disabled={busy}
            onClick={() => void act({ action: "enable" }, "Cloud Codzer is on")}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Cloud />} Turn on Cloud Codzer
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void act({ action: "enable" }).then((result) => result && setSection("connection"))
            }
          >
            <Plug /> Use my own Supabase
          </Button>
        </div>
      </div>
    );
  }

  const managedElsewhere = (
    <div className="m-4 rounded-xl border border-border bg-background p-5 text-sm">
      <p className="font-medium">This project uses your own Supabase.</p>
      <p className="mt-1 text-muted-foreground">
        Tables, users and files are managed in your Supabase dashboard.
      </p>
      <a
        href={status?.supabaseUrl.replace(
          /^https:\/\/([a-z0-9]+)\.supabase\.co$/,
          "https://supabase.com/dashboard/project/$1",
        )}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
      >
        Open Supabase dashboard <ExternalLink className="size-3" />
      </a>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium">
          <span className="size-1.5 rounded-full bg-success" />
          {ownSupabase ? "Your Supabase" : "Cloud Codzer"}
        </span>
        {!ownSupabase && (
          <span className="text-[11px] text-muted-foreground">
            {tables.length} table{tables.length === 1 ? "" : "s"} · {status?.userCount ?? 0} users ·{" "}
            {status?.fileCount ?? 0} files
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={section === id}
              onClick={() => setSection(id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                section === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
        {busy && <Loader2 className="size-3.5 animate-spin text-primary" />}
      </div>

      {section === "connection" ? (
        <div className="thin-scroll flex-1 space-y-3 overflow-y-auto p-4">
          <div
            className={`rounded-xl border p-4 ${ownSupabase ? "border-border bg-background" : "border-primary/50 bg-brand-accent-soft/40"}`}
          >
            <div className="flex items-center gap-2">
              <Cloud className="size-4 text-primary" />
              <h3 className="text-sm font-semibold">Cloud Codzer</h3>
              {!ownSupabase && (
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-success">
                  <Check className="size-3" /> In use
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Built-in database, accounts and storage. The AI creates the tables for you.
            </p>
            {ownSupabase && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={busy}
                onClick={() => void act({ action: "useCodzer" }, "Switched to Cloud Codzer")}
              >
                Switch to Cloud Codzer
              </Button>
            )}
          </div>
          <form
            className={`rounded-xl border p-4 ${ownSupabase ? "border-primary/50 bg-brand-accent-soft/40" : "border-border bg-background"}`}
            onSubmit={(event) => {
              event.preventDefault();
              void act(
                { action: "connectSupabase", supabaseUrl: link.url, supabaseKey: link.key },
                "Supabase connected",
              ).then((result) => result && setLink((current) => ({ ...current, key: "" })));
            }}
          >
            <div className="flex items-center gap-2">
              <Plug className="size-4 text-primary" />
              <h3 className="text-sm font-semibold">My own Supabase</h3>
              {ownSupabase && (
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-success">
                  <Check className="size-3" /> In use
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Keep the data in your Supabase account. Find both values in Supabase under Project
              Settings → API.
            </p>
            <label className="mt-3 block text-[11px] font-medium text-muted-foreground">
              Project URL
              <input
                className={`${field} mt-1 font-mono`}
                dir="ltr"
                placeholder="https://abcdefgh.supabase.co"
                value={link.url}
                onChange={(event) => setLink({ ...link, url: event.target.value })}
              />
            </label>
            <label className="mt-2 block text-[11px] font-medium text-muted-foreground">
              Public key (anon / publishable)
              <input
                className={`${field} mt-1 font-mono`}
                dir="ltr"
                placeholder={
                  ownSupabase ? "Saved — paste a new key to replace it" : "sb_publishable_…"
                }
                value={link.key}
                onChange={(event) => setLink({ ...link, key: event.target.value })}
              />
            </label>
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3 shrink-0 text-success" />
              Only the public key is accepted. Secret and service keys are refused because they
              would be visible inside your app.
            </p>
            <Button size="sm" className="mt-3" disabled={busy || !link.url || !link.key}>
              {ownSupabase ? "Update connection" : "Connect Supabase"}
            </Button>
          </form>
        </div>
      ) : ownSupabase ? (
        managedElsewhere
      ) : section === "users" ? (
        <div className="thin-scroll flex-1 overflow-y-auto p-4">
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody has signed up in your app yet. People appear here once they create an account.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-background">
              {users.map((user) => (
                <li key={user.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium" dir="ltr">
                    {user.email}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(user.created_at).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${user.email}`}
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      void confirmDialog({
                        title: "Remove this user?",
                        description: `${user.email} will no longer be able to sign in to your app.`,
                        confirmLabel: "Remove user",
                        danger: true,
                      }).then((yes) =>
                        yes ? act({ action: "deleteUser", id: user.id }, "User removed") : null,
                      )
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : section === "files" ? (
        <div className="thin-scroll flex-1 overflow-y-auto p-4">
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No files yet. Files your app uploads appear here (up to 5 MB each).
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-background">
              {files.map((file) => (
                <li key={file.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <a
                    href={`/api/public/cloud/${encodeURIComponent(projectId)}?file=${encodeURIComponent(file.path)}`}
                    target="_blank"
                    rel="noreferrer"
                    dir="ltr"
                    className="min-w-0 flex-1 truncate font-mono hover:text-primary"
                  >
                    {file.path}
                  </a>
                  <span className="text-muted-foreground">{formatBytes(file.size_bytes)}</span>
                  <button
                    type="button"
                    aria-label={`Delete ${file.path}`}
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      void confirmDialog({
                        title: "Delete this file?",
                        description: `${file.path} will be removed for good.`,
                        confirmLabel: "Delete file",
                        danger: true,
                      }).then((yes) =>
                        yes ? act({ action: "deleteFile", id: file.id }, "File deleted") : null,
                      )
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="thin-scroll flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-secondary/30 p-2">
            {tables.map((item) => (
              <button
                key={item.name}
                type="button"
                onClick={() => setSelected(item.name)}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs ${
                  item.name === tableName
                    ? "bg-background font-medium text-foreground ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Table2 className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-mono">{item.name}</span>
                <span className="text-[10px] text-muted-foreground">{item.rows}</span>
              </button>
            ))}
            <button
              type="button"
              className="mt-1 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
              onClick={async () => {
                const name = await promptDialog({
                  title: "New table",
                  label: "Table name",
                  description:
                    "Use lowercase letters, numbers and underscores, starting with a letter.",
                  placeholder: "products",
                  confirmLabel: "Create table",
                });
                if (!name) return;
                void act(
                  {
                    action: "applySchema",
                    tables: [{ name, columns: [], read: "public", write: "public" }],
                  },
                  "Table created",
                ).then((result) => result && setSelected(name));
              }}
            >
              <Plus className="size-3.5" /> New table
            </button>
          </div>

          {!table ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
              No tables yet. Ask the AI for an app that saves data and it will create them, or add
              one yourself.
            </div>
          ) : (
            <div className="thin-scroll min-w-0 flex-1 overflow-auto p-3">
              <div className="flex flex-wrap items-end gap-3">
                {(["read", "write"] as const).map((kind) => (
                  <label key={kind} className="text-[11px] font-medium text-muted-foreground">
                    Who can {kind}
                    <select
                      className={`${fieldBase} mt-1 block w-40`}
                      value={table[kind]}
                      disabled={busy}
                      onChange={(event) =>
                        saveTable(
                          { [kind]: event.target.value as CloudAccess },
                          "Access rule updated",
                        )
                      }
                    >
                      {CLOUD_ACCESS.map((access) => (
                        <option key={access} value={access}>
                          {ACCESS_LABEL[access]}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Refresh"
                    aria-label="Refresh records"
                    onClick={() => void act({ action: "rows", table: table.name })}
                  >
                    <RefreshCw />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Delete table"
                    aria-label="Delete table"
                    onClick={() =>
                      void confirmDialog({
                        title: `Delete table "${table.name}"?`,
                        description: `The table and all ${table.rows} record(s) in it will be removed for good.`,
                        confirmLabel: "Delete table",
                        danger: true,
                      }).then((yes) =>
                        yes
                          ? act({ action: "dropTable", table: table.name }, "Table deleted")
                          : null,
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <form
                className="mt-3 flex flex-wrap items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = newColumn.name.trim();
                  if (!name || columns.some((column) => column.name === name)) return;
                  saveTable(
                    { columns: [...columns, { name, type: newColumn.type }] },
                    "Column added",
                  );
                  setNewColumn({ name: "", type: "text" });
                }}
              >
                {columns.map((column) => (
                  <span
                    key={column.name}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-2 pr-1 font-mono text-[11px]"
                  >
                    {column.name}
                    <span className="text-muted-foreground">{column.type}</span>
                    <button
                      type="button"
                      aria-label={`Remove column ${column.name}`}
                      className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        saveTable(
                          { columns: columns.filter((item) => item.name !== column.name) },
                          "Column removed",
                        )
                      }
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  aria-label="New column name"
                  className={`${fieldBase} w-28 font-mono`}
                  placeholder="new_column"
                  value={newColumn.name}
                  onChange={(event) => setNewColumn({ ...newColumn, name: event.target.value })}
                />
                <select
                  aria-label="New column type"
                  className={`${fieldBase} w-24`}
                  value={newColumn.type}
                  onChange={(event) =>
                    setNewColumn({ ...newColumn, type: event.target.value as ColumnType })
                  }
                >
                  {CLOUD_COLUMN_TYPES.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
                <Button size="sm" variant="outline" disabled={busy || !newColumn.name.trim()}>
                  <Plus /> Column
                </Button>
              </form>

              <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-background">
                <table className="w-full text-left text-xs">
                  <thead className="bg-secondary/50 text-[11px] text-muted-foreground">
                    <tr>
                      {[...columns.map((column) => column.name), ...extraKeys, "created_at"].map(
                        (name) => (
                          <th
                            key={name}
                            className="whitespace-nowrap px-3 py-2 font-mono font-medium"
                          >
                            {name}
                          </th>
                        ),
                      )}
                      <th className="w-16 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {draft && (
                      <tr className="bg-brand-accent-soft/30">
                        {columns.map((column) => (
                          <td key={column.name} className="px-1.5 py-1.5">
                            {column.type === "boolean" ? (
                              <select
                                aria-label={column.name}
                                className={field}
                                value={draft.values[column.name] ?? ""}
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    values: { ...draft.values, [column.name]: event.target.value },
                                  })
                                }
                              >
                                <option value="">—</option>
                                <option>true</option>
                                <option>false</option>
                              </select>
                            ) : (
                              <input
                                aria-label={column.name}
                                dir="auto"
                                type={
                                  column.type === "number"
                                    ? "number"
                                    : column.type === "date"
                                      ? "date"
                                      : "text"
                                }
                                step="any"
                                className={field}
                                value={draft.values[column.name] ?? ""}
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    values: { ...draft.values, [column.name]: event.target.value },
                                  })
                                }
                              />
                            )}
                          </td>
                        ))}
                        <td colSpan={extraKeys.length + 1} />
                        <td className="whitespace-nowrap px-2">
                          <button
                            type="button"
                            aria-label="Save record"
                            className="rounded p-1 text-success hover:bg-secondary"
                            onClick={saveDraft}
                          >
                            <Check className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded px-1 text-[11px] text-muted-foreground hover:text-foreground"
                            onClick={() => setDraft(null)}
                          >
                            Cancel
                          </button>
                        </td>
                      </tr>
                    )}
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        className="cursor-pointer hover:bg-secondary/40"
                        onDoubleClick={() =>
                          setDraft({
                            id: row.id,
                            values: Object.fromEntries(
                              columns.map((column) => [column.name, show(row.data[column.name])]),
                            ),
                          })
                        }
                      >
                        {[...columns.map((column) => column.name), ...extraKeys].map((name) => (
                          <td key={name} dir="auto" className="max-w-56 truncate px-3 py-2">
                            {show(row.data[name])}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {new Date(row.created_at).toLocaleString()}
                        </td>
                        <td className="px-2 text-right">
                          <button
                            type="button"
                            aria-label="Delete record"
                            className="rounded p-1 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              void confirmDialog({
                                title: "Delete this record?",
                                description: "This cannot be undone.",
                                confirmLabel: "Delete record",
                                danger: true,
                              }).then((yes) =>
                                yes
                                  ? act({ action: "deleteRow", table: table.name, id: row.id })
                                  : null,
                              )
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && !draft && (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    No records yet.
                  </p>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || columns.length === 0 || draft !== null}
                  onClick={() => setDraft({ id: "", values: {} })}
                >
                  <Plus /> Add record
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {rows.length ? "Double-click a record to edit it. Showing the newest 200." : ""}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
