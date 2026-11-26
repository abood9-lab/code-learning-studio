import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  KeyRound,
  Loader2,
  PlugZap,
  Power,
  RefreshCw,
  TerminalSquare,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { sandboxAction } from "@/lib/workspace.functions";

type LineKind = "command" | "output" | "error" | "info";
interface TerminalLine {
  kind: LineKind;
  text: string;
  cwd?: string;
}

interface DaytonaTerminalProps {
  projectId: string;
  /** Saves the workspace (creating the project when needed) and returns its id. */
  ensureProject: () => Promise<string>;
  hasFiles: boolean;
  onOpenSecrets: () => void;
}

const HOME = "/home/daytona";
const DEFAULT_CWD = `${HOME}/workspace`;
const TRANSITIONAL = [
  "creating",
  "starting",
  "stopping",
  "pending",
  "building",
  "restoring",
  "pulling_snapshot",
  "unknown",
];
const QUICK_COMMANDS = ["ls -la", "node -v", "npm install", "python3 --version"];

const shortCwd = (cwd: string) => (cwd.startsWith(HOME) ? `~${cwd.slice(HOME.length)}` : cwd);

export function DaytonaTerminal({
  projectId,
  ensureProject,
  hasFiles,
  onOpenSecrets,
}: DaytonaTerminalProps) {
  const action = useServerFn(sandboxAction);
  const [state, setState] = useState("none");
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState(DEFAULT_CWD);
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSyncRef = useRef(false);

  const push = useCallback((kind: LineKind, text: string, lineCwd?: string) => {
    setLines((previous) => [
      ...previous.slice(-400),
      { kind, text, ...(lineCwd ? { cwd: lineCwd } : {}) },
    ]);
  }, []);

  useEffect(() => {
    setState("none");
    setLines([]);
    setCwd(DEFAULT_CWD);
    if (!projectId) return;
    let cancelled = false;
    action({ data: { projectId, action: "status" } })
      .then((result) => {
        if (!cancelled) setState(result.state);
      })
      .catch(() => {
        if (!cancelled) push("error", "Could not check the sandbox status.");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, action, push]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines, busy]);

  const syncFiles = useCallback(
    async (id: string) => {
      const result = await action({ data: { projectId: id, action: "sync" } });
      push("info", result.output);
    },
    [action, push],
  );

  // Poll while the sandbox is changing state; once it is running, upload the project files once.
  useEffect(() => {
    if (!projectId) return;
    if (state === "started" && autoSyncRef.current) {
      autoSyncRef.current = false;
      push("info", "Sandbox is running.");
      if (hasFiles)
        void syncFiles(projectId).catch((error: unknown) =>
          push("error", error instanceof Error ? error.message : "Sync failed"),
        );
      inputRef.current?.focus();
      return;
    }
    if (!TRANSITIONAL.includes(state)) return;
    const timer = setInterval(() => {
      action({ data: { projectId, action: "status" } })
        .then((result) => setState(result.state))
        .catch(() => setState("error"));
    }, 2500);
    return () => clearInterval(timer);
  }, [state, projectId, action, hasFiles, syncFiles, push]);

  const connect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      push("info", "Connecting to Daytona…");
      const id = await ensureProject();
      autoSyncRef.current = true;
      const result = await action({ data: { projectId: id, action: "connect" } });
      setState(result.state);
    } catch (error) {
      autoSyncRef.current = false;
      push("error", error instanceof Error ? error.message : "Could not connect to Daytona");
    } finally {
      setBusy(false);
    }
  };

  const simple = async (kind: "sync" | "stop" | "status") => {
    if (busy || !projectId) return;
    setBusy(true);
    try {
      if (kind === "sync") {
        const id = await ensureProject();
        await syncFiles(id);
      } else {
        const result = await action({ data: { projectId, action: kind } });
        setState(result.state);
        if (result.output) push("info", result.output);
      }
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Daytona operation failed");
    } finally {
      setBusy(false);
    }
  };

  const run = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setCommand("");
    setCursor(-1);
    if (text === "clear") {
      setLines([]);
      return;
    }
    setHistory((previous) => [...previous.filter((item) => item !== text), text].slice(-100));
    push("command", text, cwd);
    if (state !== "started" || !projectId) {
      push("error", "The sandbox is not running. Press Connect first.");
      return;
    }
    setBusy(true);
    try {
      const result = await action({ data: { projectId, action: "execute", command: text, cwd } });
      setState(result.state);
      setCwd(result.cwd);
      if (result.output.trim())
        push(result.exitCode ? "error" : "output", result.output.replace(/\n+$/, ""));
      if (result.exitCode) push("info", `exit code ${result.exitCode}`);
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Command failed");
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const running = state === "started";
  const changing = TRANSITIONAL.includes(state);
  const dot = running
    ? "bg-terminal-accent"
    : changing
      ? "animate-pulse bg-warning"
      : state === "error"
        ? "bg-terminal-danger"
        : "bg-terminal-muted";
  const iconButton =
    "inline-flex size-7 items-center justify-center rounded-md text-terminal-muted transition-colors hover:bg-terminal-border hover:text-terminal-foreground disabled:pointer-events-none disabled:opacity-35";

  return (
    <section
      className="flex min-h-0 flex-1 flex-col bg-terminal text-terminal-foreground"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-terminal-border px-3 py-2">
        <span className="flex items-center gap-2 font-mono text-xs">
          <TerminalSquare className="size-4 text-terminal-accent" />
          daytona
          <span className="flex items-center gap-1.5 rounded-full border border-terminal-border px-2 py-0.5 text-[11px] text-terminal-muted">
            <span className={`size-1.5 rounded-full ${dot}`} />
            {running ? "running" : state === "none" ? "not connected" : state}
          </span>
        </span>
        <div className="flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
          {!running && (
            <button
              type="button"
              disabled={busy || changing}
              onClick={() => void connect()}
              className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-md bg-terminal-accent px-2.5 text-xs font-semibold text-terminal transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy || changing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <PlugZap className="size-3.5" />
              )}
              {changing ? "Starting…" : "Connect"}
            </button>
          )}
          <button
            type="button"
            className={iconButton}
            title="Upload project files to the sandbox"
            aria-label="Upload project files to the sandbox"
            disabled={busy || !running || !hasFiles}
            onClick={() => void simple("sync")}
          >
            <UploadCloud className="size-3.5" />
          </button>
          <button
            type="button"
            className={iconButton}
            title="Project API keys"
            aria-label="Project API keys"
            onClick={onOpenSecrets}
          >
            <KeyRound className="size-3.5" />
          </button>
          <button
            type="button"
            className={iconButton}
            title="Refresh status"
            aria-label="Refresh status"
            disabled={busy || !projectId}
            onClick={() => void simple("status")}
          >
            <RefreshCw className="size-3.5" />
          </button>
          <button
            type="button"
            className={iconButton}
            title="Stop sandbox"
            aria-label="Stop sandbox"
            disabled={busy || !running}
            onClick={() => void simple("stop")}
          >
            <Power className="size-3.5" />
          </button>
          <button
            type="button"
            className={iconButton}
            title="Clear terminal"
            aria-label="Clear terminal"
            onClick={() => setLines([])}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div
        className="thin-scroll min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[12.5px] leading-6"
        role="log"
        aria-label="Terminal output"
        dir="ltr"
      >
        {lines.length === 0 && (
          <div className="text-terminal-muted">
            <p>Whiterchat cloud terminal · powered by Daytona</p>
            <p>
              {running
                ? "Connected. Your files live in ~/workspace — try a command below."
                : "Press Connect to start a private Linux sandbox for this project."}
            </p>
          </div>
        )}
        {lines.map((line, index) =>
          line.kind === "command" ? (
            <p key={index} className="whitespace-pre-wrap break-all">
              <span className="text-terminal-accent">{shortCwd(line.cwd ?? cwd)} $</span>{" "}
              {line.text}
            </p>
          ) : (
            <pre
              key={index}
              className={`whitespace-pre-wrap break-words font-mono ${
                line.kind === "error"
                  ? "text-terminal-danger"
                  : line.kind === "info"
                    ? "text-terminal-muted"
                    : ""
              }`}
            >
              {line.text}
            </pre>
          ),
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(command);
          }}
        >
          <span className="shrink-0 text-terminal-accent">{shortCwd(cwd)} $</span>
          <input
            ref={inputRef}
            aria-label="Terminal command"
            value={command}
            disabled={busy}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" && history.length) {
                event.preventDefault();
                const next = cursor < 0 ? history.length - 1 : Math.max(0, cursor - 1);
                setCursor(next);
                setCommand(history[next] ?? "");
              } else if (event.key === "ArrowDown" && cursor >= 0) {
                event.preventDefault();
                const next = cursor + 1;
                if (next >= history.length) {
                  setCursor(-1);
                  setCommand("");
                } else {
                  setCursor(next);
                  setCommand(history[next] ?? "");
                }
              } else if (event.key.toLowerCase() === "l" && event.ctrlKey) {
                event.preventDefault();
                setLines([]);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-terminal-foreground caret-terminal-accent outline-none placeholder:text-terminal-muted/60"
            placeholder={busy ? "" : running ? "type a command…" : ""}
          />
          {busy && <Loader2 className="size-3.5 shrink-0 animate-spin text-terminal-accent" />}
        </form>
        <div ref={endRef} />
      </div>

      {running && (
        <div
          className="flex flex-wrap gap-1.5 border-t border-terminal-border px-3 py-2"
          onClick={(event) => event.stopPropagation()}
        >
          {QUICK_COMMANDS.map((item) => (
            <button
              key={item}
              type="button"
              disabled={busy}
              onClick={() => void run(item)}
              className="rounded-md border border-terminal-border px-2 py-0.5 font-mono text-[11px] text-terminal-muted transition-colors hover:border-terminal-accent hover:text-terminal-foreground disabled:opacity-40"
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
