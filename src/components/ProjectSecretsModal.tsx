import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { confirmDialog } from "@/components/AppDialogs";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { manageProjectSecrets } from "@/lib/workspace.functions";
import type { SecretRequest } from "@/lib/workspace-protocol";

interface ProjectSecretsModalProps {
  open: boolean;
  requests: SecretRequest[];
  /** Creates the project when it does not exist yet and returns its id. */
  ensureProject: () => Promise<string>;
  onClose: () => void;
  onKeysChanged: (names: string[]) => void;
}

const NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

export function ProjectSecretsModal({
  open,
  requests,
  ensureProject,
  onClose,
  onKeysChanged,
}: ProjectSecretsModalProps) {
  const manage = useServerFn(manageProjectSecrets);
  const [projectId, setProjectId] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [customName, setCustomName] = useState("");
  const [extra, setExtra] = useState<string[]>([]);

  const applyKeys = useCallback(
    (keys: Array<{ name: string }>) => {
      const names = keys.map((key) => key.name);
      setSaved(names);
      onKeysChanged(names);
    },
    [onKeysChanged],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setValues({});
    setVisible({});
    setExtra([]);
    setCustomName("");
    void (async () => {
      try {
        const id = await ensureProject();
        if (cancelled) return;
        setProjectId(id);
        const result = await manage({ data: { projectId: id, action: "list" } });
        if (!cancelled) applyKeys(result.keys);
      } catch (error) {
        if (!cancelled)
          toast.error(error instanceof Error ? error.message : "Could not open project keys");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Reload only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async (name: string) => {
    const value = values[name]?.trim();
    if (!value || !projectId) return;
    setBusy(name);
    try {
      const result = await manage({ data: { projectId, action: "save", name, value } });
      applyKeys(result.keys);
      setValues((previous) => ({ ...previous, [name]: "" }));
      toast.success(`${name} saved securely`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save key");
    } finally {
      setBusy("");
    }
  };

  const remove = async (name: string) => {
    if (
      !projectId ||
      !(await confirmDialog({
        title: "Remove this key?",
        description: `${name} will be removed from this project.`,
        confirmLabel: "Remove key",
        danger: true,
      }))
    )
      return;
    setBusy(name);
    try {
      const result = await manage({ data: { projectId, action: "delete", name } });
      applyKeys(result.keys);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove key");
    } finally {
      setBusy("");
    }
  };

  const requestedNames = requests.map((request) => request.name);
  const rows: Array<{ name: string; reason: string; requested: boolean }> = [
    ...requests.map((request) => ({ name: request.name, reason: request.reason, requested: true })),
    ...extra
      .filter((name) => !requestedNames.includes(name))
      .map((name) => ({ name, reason: "", requested: false })),
    ...saved
      .filter((name) => !requestedNames.includes(name) && !extra.includes(name))
      .map((name) => ({ name, reason: "", requested: false })),
  ];
  const missing = requests.filter((request) => !saved.includes(request.name)).length;
  const normalizedCustom = customName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88dvh] gap-0 overflow-hidden border-border p-0 outline-none sm:max-w-xl">
        <DialogHeader className="border-b border-border px-6 py-5 text-start">
          <div className="flex items-start gap-3.5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-accent-soft text-primary">
              <KeyRound className="size-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base">
                {requests.length ? "This project needs API keys" : "Project API keys"}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-relaxed">
                {requests.length
                  ? "Paste each key below. They are encrypted, never shown to the AI and never placed in your code or preview."
                  : "Keys are encrypted and only available to commands in this project's cloud terminal."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="thin-scroll max-h-[56dvh] space-y-3 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {rows.length === 0 && (
                <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No keys yet. Add one below when your project needs a private service.
                </p>
              )}
              {rows.map((row) => {
                const isSaved = saved.includes(row.name);
                return (
                  <div
                    key={row.name}
                    className={`rounded-xl border p-3.5 transition-colors ${
                      isSaved
                        ? "border-success/40 bg-success/5"
                        : row.requested
                          ? "border-primary/40 bg-brand-accent-soft"
                          : "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className="truncate font-mono text-[13px] font-medium">{row.name}</code>
                      {isSaved ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                          <Check className="size-3" /> Saved
                        </span>
                      ) : (
                        row.requested && (
                          <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                            Required
                          </span>
                        )
                      )}
                    </div>
                    {row.reason && (
                      <p dir="auto" className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {row.reason}
                      </p>
                    )}
                    <form
                      className="mt-2.5 flex items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void save(row.name);
                      }}
                    >
                      <div className="relative min-w-0 flex-1">
                        <Lock className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type={visible[row.name] ? "text" : "password"}
                          autoComplete="off"
                          spellCheck={false}
                          aria-label={`Value for ${row.name}`}
                          value={values[row.name] ?? ""}
                          onChange={(event) =>
                            setValues((previous) => ({
                              ...previous,
                              [row.name]: event.target.value,
                            }))
                          }
                          placeholder={
                            isSaved ? "•••••••• (paste to replace)" : "Paste the key value"
                          }
                          className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-9 font-mono text-xs outline-none focus:border-primary"
                        />
                        <button
                          type="button"
                          aria-label={visible[row.name] ? "Hide value" : "Show value"}
                          onClick={() =>
                            setVisible((previous) => ({
                              ...previous,
                              [row.name]: !previous[row.name],
                            }))
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                        >
                          {visible[row.name] ? (
                            <EyeOff className="size-3.5" />
                          ) : (
                            <Eye className="size-3.5" />
                          )}
                        </button>
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!values[row.name]?.trim() || busy === row.name}
                      >
                        {busy === row.name ? (
                          <Loader2 className="animate-spin" />
                        ) : isSaved ? (
                          "Replace"
                        ) : (
                          "Save"
                        )}
                      </Button>
                      {isSaved && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${row.name}`}
                          disabled={busy === row.name}
                          onClick={() => void remove(row.name)}
                        >
                          <Trash2 className="text-destructive" />
                        </Button>
                      )}
                    </form>
                  </div>
                );
              })}

              <form
                className="flex items-center gap-2 pt-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!NAME_PATTERN.test(normalizedCustom)) {
                    toast.error("Use a name like STRIPE_SECRET_KEY");
                    return;
                  }
                  if (!rows.some((row) => row.name === normalizedCustom))
                    setExtra((previous) => [...previous, normalizedCustom]);
                  setCustomName("");
                }}
              >
                <input
                  aria-label="New key name"
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  placeholder="Add another key, e.g. OPENAI_API_KEY"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-dashed border-input bg-transparent px-3 font-mono text-xs outline-none focus:border-primary"
                />
                <Button type="submit" variant="outline" size="sm" disabled={!customName.trim()}>
                  <Plus /> Add
                </Button>
              </form>
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-secondary/40 px-6 py-3.5">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-success" /> Encrypted · server-side only
          </span>
          <Button size="sm" variant={missing ? "outline" : "default"} onClick={onClose}>
            {missing ? `Later (${missing} missing)` : "Done"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
