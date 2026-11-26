import { useEffect, useMemo, useRef } from "react";
import {
  Check,
  FileCode,
  FileJson,
  FileText,
  FileType,
  Loader2,
  Palette,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import type { WorkspaceFile } from "@/lib/types";

interface CodeViewProps {
  files: Record<string, WorkspaceFile>;
  selectedPath: string;
  onSelect: (path: string) => void;
  /** Path the AI is writing right now, or "" when idle. */
  livePath: string;
  streaming: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCreate: () => void;
  onDelete: (path: string) => void;
  onChange: (path: string, content: string) => void;
}

const fileIcon = (path: string) => {
  if (/\.html?$/i.test(path)) return FileCode;
  if (/\.(css|scss)$/i.test(path)) return Palette;
  if (/\.json$/i.test(path)) return FileJson;
  if (/\.(md|txt)$/i.test(path)) return FileText;
  return FileType;
};

export function CodeView({
  files,
  selectedPath,
  onSelect,
  livePath,
  streaming,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCreate,
  onDelete,
  onChange,
}: CodeViewProps) {
  const paths = useMemo(() => Object.keys(files).sort(), [files]);
  const activePath = selectedPath && files[selectedPath] ? selectedPath : (paths[0] ?? "");
  const content = files[activePath]?.content ?? "";
  const isLive = streaming && activePath === livePath;
  const lineCount = useMemo(() => content.split("\n").length, [content]);
  const gutterRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view while the AI is typing.
  useEffect(() => {
    if (isLive && liveRef.current) liveRef.current.scrollTop = liveRef.current.scrollHeight;
  }, [content, isLive]);

  const gutter = (
    <div
      ref={gutterRef}
      aria-hidden="true"
      className="w-11 shrink-0 select-none overflow-hidden bg-secondary/40 py-3 pr-2 text-right font-mono text-[11px] leading-[1.6] text-muted-foreground/70"
    >
      {Array.from({ length: lineCount }, (_, index) => (
        <div key={index}>{index + 1}</div>
      ))}
    </div>
  );
  const smallButton =
    "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-35";

  return (
    <div className="flex min-h-0 flex-1">
      <div className="thin-scroll flex w-36 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar sm:w-48">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Files
          </span>
          <button
            type="button"
            className={smallButton}
            title="New file"
            aria-label="New file"
            disabled={streaming}
            onClick={onCreate}
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <ul className="space-y-0.5 px-1.5 pb-3">
          {paths.map((path) => {
            const Icon = fileIcon(path);
            const writing = streaming && path === livePath;
            return (
              <li key={path}>
                <button
                  type="button"
                  title={path}
                  onClick={() => onSelect(path)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs transition-colors ${
                    activePath === path
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-secondary"
                  }`}
                >
                  <Icon className="size-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">{path}</span>
                  {writing ? (
                    <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
                  ) : (
                    streaming && <Check className="size-3 shrink-0 text-success" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-xs text-foreground">
              {activePath || "No file selected"}
            </span>
            {isLive && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-accent-soft px-2 py-0.5 text-[11px] font-medium text-primary">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" /> AI is writing
              </span>
            )}
          </span>
          <div className="flex shrink-0 items-center">
            <span className="mr-2 hidden font-mono text-[11px] text-muted-foreground sm:inline">
              {lineCount} lines
            </span>
            <button
              type="button"
              className={smallButton}
              title="Undo"
              aria-label="Undo"
              disabled={!canUndo || streaming}
              onClick={onUndo}
            >
              <Undo2 className="size-3.5" />
            </button>
            <button
              type="button"
              className={smallButton}
              title="Redo"
              aria-label="Redo"
              disabled={!canRedo || streaming}
              onClick={onRedo}
            >
              <Redo2 className="size-3.5" />
            </button>
            <button
              type="button"
              className={smallButton}
              title="Delete file"
              aria-label="Delete file"
              disabled={!activePath || streaming}
              onClick={() => onDelete(activePath)}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>

        {streaming ? (
          <div
            ref={liveRef}
            className="thin-scroll flex min-h-0 flex-1 overflow-auto"
            dir="ltr"
            aria-live="off"
          >
            {gutter}
            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words px-3 py-3 font-mono text-xs leading-[1.6] text-foreground">
              {content}
              {isLive && <span className="live-caret" />}
            </pre>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1" dir="ltr">
            {gutter}
            <textarea
              aria-label="File contents"
              value={content}
              wrap="off"
              spellCheck={false}
              disabled={!activePath}
              onScroll={(event) => {
                if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
              }}
              onChange={(event) => activePath && onChange(activePath, event.target.value)}
              className="thin-scroll min-h-0 min-w-0 flex-1 resize-none bg-transparent px-3 py-3 font-mono text-xs leading-[1.6] text-foreground outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
