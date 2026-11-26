import { useEffect, useRef, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { AlertTriangle, HelpCircle, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Marks an action that removes something for good. */
  danger?: boolean;
}
interface PromptOptions {
  title: string;
  description?: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}
type Request =
  | ({ kind: "confirm"; resolve: (value: boolean) => void } & ConfirmOptions)
  | ({ kind: "prompt"; resolve: (value: string | null) => void } & PromptOptions);

let open: ((request: Request) => void) | null = null;

/** Asks the user to confirm an action. Resolves false if they cancel or no dialog host is mounted. */
export const confirmDialog = (options: ConfirmOptions) =>
  new Promise<boolean>((resolve) =>
    open ? open({ kind: "confirm", resolve, ...options }) : resolve(false),
  );

/** Asks the user for a short text. Resolves null if they cancel or leave it empty. */
export const promptDialog = (options: PromptOptions) =>
  new Promise<string | null>((resolve) =>
    open ? open({ kind: "prompt", resolve, ...options }) : resolve(null),
  );

/** Renders the app's confirm and text-input dialogs. Mount once at the root. */
export function AppDialogs() {
  const [request, setRequest] = useState<Request | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    open = (next) => {
      setValue(next.kind === "prompt" ? (next.defaultValue ?? "") : "");
      setRequest((current) => {
        if (current?.kind === "confirm") current.resolve(false);
        else current?.resolve(null);
        return next;
      });
    };
    return () => {
      open = null;
    };
  }, []);

  const close = (accepted: boolean) => {
    if (!request) return;
    if (request.kind === "confirm") request.resolve(accepted);
    else request.resolve(accepted && value.trim() ? value.trim() : null);
    setRequest(null);
  };

  const danger = request?.kind === "confirm" && request.danger;
  const Icon = request?.kind === "prompt" ? PencilLine : danger ? AlertTriangle : HelpCircle;

  return (
    <AlertDialog.Root open={request !== null} onOpenChange={(next) => !next && close(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[70] bg-background/75 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <AlertDialog.Content
          className="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-elevated outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          onOpenAutoFocus={(event) => {
            if (request?.kind !== "prompt") return;
            event.preventDefault();
            inputRef.current?.focus();
            inputRef.current?.select();
          }}
        >
          {request && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                close(true);
              }}
            >
              <div className="flex items-start gap-4">
                <span
                  className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
                    danger
                      ? "bg-destructive/15 text-destructive"
                      : "bg-brand-accent-soft text-primary"
                  }`}
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <AlertDialog.Title dir="auto" className="text-base font-semibold tracking-tight">
                    {request.title}
                  </AlertDialog.Title>
                  <AlertDialog.Description
                    dir="auto"
                    className="mt-1.5 break-words text-sm leading-relaxed text-muted-foreground"
                  >
                    {request.description ?? (request.kind === "prompt" ? request.label : "")}
                  </AlertDialog.Description>
                </div>
              </div>
              {request.kind === "prompt" && (
                <input
                  ref={inputRef}
                  aria-label={request.label}
                  dir="auto"
                  value={value}
                  placeholder={request.placeholder}
                  maxLength={200}
                  onChange={(event) => setValue(event.target.value)}
                  className="mt-5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary"
                />
              )}
              <div className="mt-6 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => close(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant={danger ? "destructive" : "default"}
                  disabled={request.kind === "prompt" && !value.trim()}
                >
                  {request.confirmLabel ?? (request.kind === "prompt" ? "Save" : "Confirm")}
                </Button>
              </div>
            </form>
          )}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
