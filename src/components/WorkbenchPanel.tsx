import { useMemo, useRef, useState } from "react";
import {
  Check,
  Cloud,
  Code2,
  Database,
  Download,
  Eye,
  FileCode,
  KeyRound,
  Loader2,
  Save,
  TerminalSquare,
  Upload,
  X,
} from "lucide-react";
import { confirmDialog, promptDialog } from "@/components/AppDialogs";
import { toast } from "sonner";
import { createProjectZip, downloadFile, makeWorkspaceFile } from "@/lib/workspace-tools";
import { starterTemplates } from "@/lib/starter-templates";
import { Button } from "@/components/ui/button";
import { ProjectLibrary } from "@/components/ProjectLibrary";
import { DaytonaTerminal } from "@/components/DaytonaTerminal";
import { PreviewFrame, type PreviewCloud } from "@/components/workbench/PreviewFrame";
import { CloudPanel } from "@/components/CloudPanel";
import type { CloudStatus } from "@/lib/cloud-core";
import type { CloudAction, CloudResult } from "@/lib/cloud.functions";
import { CodeView } from "@/components/workbench/CodeView";
import type { WorkspaceFile } from "@/lib/types";

export type WorkbenchTab = "preview" | "code" | "cloud" | "terminal";
type FileMap = Record<string, WorkspaceFile>;

interface WorkbenchPanelProps {
  files: FileMap;
  /** Files as the AI has written them so far, including the unfinished one. */
  liveFiles: FileMap | null;
  livePath: string;
  streaming: boolean;
  tab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
  projectId: string;
  projectName: string;
  onRename: (name: string) => void;
  dirty: boolean;
  saving: boolean;
  persisted: boolean;
  secretCount: number;
  onSave: () => void;
  ensureProject: () => Promise<string>;
  onReplaceFiles: (files: FileMap) => void;
  onUpdateFile: (path: string, content: string) => void;
  onLoadProject: (id: string, name: string, files: FileMap) => void;
  onOpenSecrets: () => void;
  cloud: CloudStatus | null;
  previewCloud: PreviewCloud | null;
  runCloud: (action: CloudAction) => Promise<CloudResult>;
  onClose: () => void;
}

const TABS: Array<{ id: WorkbenchTab; label: string; icon: typeof Eye }> = [
  { id: "preview", label: "Preview", icon: Eye },
  { id: "code", label: "Code", icon: Code2 },
  { id: "cloud", label: "Cloud", icon: Database },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
];

export function WorkbenchPanel(props: WorkbenchPanelProps) {
  const {
    files,
    liveFiles,
    livePath,
    streaming,
    tab,
    onTabChange,
    projectId,
    projectName,
    dirty,
    saving,
    persisted,
  } = props;
  const [selectedPath, setSelectedPath] = useState("");
  const [undo, setUndo] = useState<FileMap[]>([]);
  const [redo, setRedo] = useState<FileMap[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);

  const shownFiles = useMemo(
    () => (streaming && liveFiles ? { ...files, ...liveFiles } : files),
    [files, liveFiles, streaming],
  );
  const fileCount = Object.keys(shownFiles).length;
  const hasFiles = Object.keys(files).length > 0;
  // While the AI writes, follow the file it is working on.
  const codePath = streaming && livePath ? livePath : selectedPath;

  const changeFiles = (next: FileMap) => {
    setUndo((previous) => [...previous.slice(-49), files]);
    setRedo([]);
    props.onReplaceFiles(next);
  };

  const exportZip = () => {
    try {
      const zip = createProjectZip(files);
      downloadFile(
        `${projectName.replace(/[^\p{L}\p{N}_-]/gu, "-") || "project"}.zip`,
        new Uint8Array(zip).buffer,
        "application/zip",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    }
  };

  const importFiles = async (chosen: File[]) => {
    try {
      const next = { ...files };
      for (const file of chosen) {
        if (file.size > 2 * 1024 * 1024)
          throw new Error(`${file.name} is too large (maximum 2 MB)`);
        if (
          next[file.name] &&
          !(await confirmDialog({
            title: "Replace this file?",
            description: `${file.name} already exists in the project and will be overwritten.`,
            confirmLabel: "Replace",
          }))
        )
          continue;
        const imported = makeWorkspaceFile(file.name, await file.text());
        next[imported.path] = imported;
      }
      changeFiles(next);
      onTabChange("code");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    }
  };

  const status = saving
    ? "Saving…"
    : !hasFiles
      ? "Empty"
      : persisted && !dirty
        ? "Saved"
        : "Unsaved changes";

  return (
    <aside className="flex h-full min-w-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-accent-soft text-primary">
          <FileCode className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <input
            aria-label="Project name"
            dir="auto"
            className="w-full truncate bg-transparent text-sm font-semibold outline-none"
            value={projectName}
            onChange={(event) => props.onRename(event.target.value)}
          />
          <p className="flex items-center gap-1 text-[11px] leading-none text-muted-foreground">
            {persisted && !dirty && !saving ? (
              <Check className="size-3 text-success" />
            ) : (
              <Cloud className="size-3" />
            )}
            {status}
          </p>
        </div>
        <ProjectLibrary
          onLoad={async (id, name, next) => {
            if (
              hasFiles &&
              dirty &&
              !(await confirmDialog({
                title: "Open another project?",
                description: "This project has unsaved changes that will be lost.",
                confirmLabel: "Open anyway",
                danger: true,
              }))
            )
              return;
            setUndo([]);
            setRedo([]);
            props.onLoadProject(id, name, next);
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          title="Project API keys"
          aria-label="Project API keys"
          className="relative"
          onClick={props.onOpenSecrets}
        >
          <KeyRound />
          {props.secretCount > 0 && (
            <span className="absolute right-1 top-1 flex size-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
              {props.secretCount}
            </span>
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Import text files"
          aria-label="Import text files"
          disabled={streaming}
          onClick={() => uploadRef.current?.click()}
        >
          <Upload />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Download ZIP"
          aria-label="Download ZIP"
          disabled={!hasFiles}
          onClick={exportZip}
        >
          <Download />
        </Button>
        <Button
          size="sm"
          title="Save project"
          disabled={
            saving || streaming || !hasFiles || !projectName.trim() || (persisted && !dirty)
          }
          onClick={props.onSave}
        >
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          <span className="hidden sm:inline">Save</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Close workbench"
          aria-label="Close workbench"
          onClick={props.onClose}
        >
          <X />
        </Button>
        <input
          type="file"
          accept=".html,.css,.js,.ts,.tsx,.jsx,.json,.md,.txt,.sql,.py"
          multiple
          ref={uploadRef}
          className="hidden"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = "";
            void importFiles(chosen);
          }}
        />
      </div>

      <div
        role="tablist"
        aria-label="Workbench"
        className="flex items-center gap-1 border-b border-border bg-secondary/40 px-2 py-1.5"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTabChange(id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === id
                ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
            {id === "code" && fileCount > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                {fileCount}
              </span>
            )}
            {id === "code" && streaming && livePath && (
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      {tab === "terminal" ? (
        <DaytonaTerminal
          projectId={persisted ? projectId : ""}
          ensureProject={props.ensureProject}
          hasFiles={hasFiles}
          onOpenSecrets={props.onOpenSecrets}
        />
      ) : tab === "cloud" ? (
        <CloudPanel projectId={projectId} status={props.cloud} run={props.runCloud} />
      ) : fileCount === 0 ? (
        <div className="thin-scroll flex-1 overflow-y-auto p-6">
          <h2 className="text-lg font-semibold tracking-tight">Start with a template</h2>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">
            Or describe what you want in the chat and watch it get built here.
          </p>
          <div className="grid gap-3">
            {starterTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => {
                  props.onRename(template.name);
                  changeFiles(structuredClone(template.files));
                  onTabChange("preview");
                }}
                className="flex items-center gap-3 rounded-xl border border-border bg-background p-4 text-left transition-all hover:border-primary/50 hover:shadow-glow"
              >
                <span className="flex size-10 items-center justify-center rounded-lg bg-brand-accent-soft text-primary">
                  <FileCode className="size-4.5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{template.name}</span>
                  <span className="block text-xs text-muted-foreground">{template.subtitle}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : tab === "preview" ? (
        <PreviewFrame files={files} building={streaming} cloud={props.previewCloud} />
      ) : (
        <CodeView
          files={shownFiles}
          selectedPath={codePath}
          onSelect={setSelectedPath}
          livePath={livePath}
          streaming={streaming}
          canUndo={undo.length > 0}
          canRedo={redo.length > 0}
          onUndo={() => {
            const previous = undo.at(-1);
            if (!previous) return;
            setRedo((stack) => [...stack, files]);
            setUndo((stack) => stack.slice(0, -1));
            props.onReplaceFiles(previous);
          }}
          onRedo={() => {
            const next = redo.at(-1);
            if (!next) return;
            setUndo((stack) => [...stack, files]);
            setRedo((stack) => stack.slice(0, -1));
            props.onReplaceFiles(next);
          }}
          onCreate={async () => {
            const path = await promptDialog({
              title: "New file",
              label: "File path",
              defaultValue: "new-file.js",
              confirmLabel: "Create file",
            });
            if (!path) return;
            try {
              const file = makeWorkspaceFile(path, "");
              if (files[file.path]) throw new Error("File already exists");
              changeFiles({ ...files, [file.path]: file });
              setSelectedPath(file.path);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Invalid path");
            }
          }}
          onDelete={async (path) => {
            if (
              !(await confirmDialog({
                title: "Delete this file?",
                description: `${path} will be removed from the project.`,
                confirmLabel: "Delete file",
                danger: true,
              }))
            )
              return;
            const next = { ...files };
            delete next[path];
            changeFiles(next);
          }}
          onChange={(path, content) => {
            setUndo((previous) => [...previous.slice(-49), files]);
            setRedo([]);
            props.onUpdateFile(path, content);
          }}
        />
      )}
    </aside>
  );
}
