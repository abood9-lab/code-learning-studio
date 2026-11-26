import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUp,
  Download,
  Hammer,
  ListChecks,
  Loader2,
  Menu,
  Moon,
  PanelRightOpen,
  Pencil,
  Plus,
  Search,
  Shield,
  Sparkles,
  Square,
  Sun,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import { confirmDialog, promptDialog } from "@/components/AppDialogs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { inferLanguage, parseArtifactsFromText } from "@/lib/artifact-parser";
import {
  extractSecretRequests,
  planningQuestionsSchema,
  streamedFiles,
  type PlanningQuestion,
  type SecretRequest,
} from "@/lib/workspace-protocol";
import { conversationMarkdown, downloadFile } from "@/lib/workspace-tools";
import { manageProjectSecrets } from "@/lib/workspace.functions";
import { cloudAdmin, type CloudAction } from "@/lib/cloud.functions";
import { extractCloudSchema, type CloudStatus } from "@/lib/cloud-core";
import type {
  ChatMessage,
  ChatSession,
  ExecutionMode,
  ProviderId,
  WorkspaceFile,
} from "@/lib/types";
import { BrandLogo } from "@/components/BrandLogo";
import { ModelSelector } from "@/components/ModelSelector";
import { ProfileModal } from "@/components/ProfileModal";
import { WorkbenchPanel, type WorkbenchTab } from "@/components/WorkbenchPanel";
import { PlanningModal, type PlanningAnswer } from "@/components/PlanningModal";
import { ProjectSecretsModal } from "@/components/ProjectSecretsModal";
import { ChatMessageItem } from "@/components/chat/ChatMessageItem";
import { Button } from "@/components/ui/button";

type FileMap = Record<string, WorkspaceFile>;

interface ChatWorkspaceProps {
  chatId?: string;
  initialPrompt?: string;
  initialProvider?: ProviderId;
  initialModel?: string;
  initialMode?: ExecutionMode;
}

interface PlanningState {
  loading: boolean;
  questions: PlanningQuestion[];
  history: ChatMessage[];
  chatId: string;
  text: string;
}

const DEFAULT_PROJECT_NAME = "Untitled project";
const SUGGESTIONS = [
  "A landing page for a specialty coffee shop with a menu and booking form",
  "A personal finance tracker with charts and monthly budgets",
  "A kanban task board with drag and drop",
  "A weather dashboard that calls a weather API",
];

const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const snapshotOf = (name: string, files: FileMap) => JSON.stringify({ name, files });

/** Providers reject two messages in a row from the same role, so merge them. */
function toApiMessages(history: ChatMessage[]) {
  const merged: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of history) {
    if (!message.content.trim()) continue;
    const last = merged.at(-1);
    if (last && last.role === message.role)
      last.content = `${last.content}\n\n${message.content}`.slice(0, 60000);
    else merged.push({ role: message.role, content: message.content.slice(0, 60000) });
  }
  return merged;
}

function parseQuestions(text: string): PlanningQuestion[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = planningQuestionsSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data.questions : null;
  } catch {
    return null;
  }
}

export function ChatWorkspace({
  chatId,
  initialPrompt,
  initialProvider = "lovable",
  initialModel = "openai/gpt-6.1-terra",
  initialMode = "build",
}: ChatWorkspaceProps) {
  const navigate = useNavigate();
  const {
    session,
    user,
    profile,
    isAdmin,
    loading: authLoading,
    refreshProfile,
    signOut,
  } = useAuth();
  const listSecrets = useServerFn(manageProjectSecrets);
  const cloudFn = useServerFn(cloudAdmin);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [tab, setTab] = useState<WorkbenchTab>("preview");
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  const [history, setHistory] = useState<ChatSession[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [activeChatId, setActiveChatId] = useState(chatId && chatId !== "new" ? chatId : "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<ProviderId>(initialProvider);
  const [model, setModel] = useState(initialModel);
  const [mode, setMode] = useState<ExecutionMode>(initialMode);
  const [streaming, setStreaming] = useState(false);
  const [enhancing, setEnhancing] = useState(false);

  const [files, setFiles] = useState<FileMap>({});
  const [live, setLive] = useState<{ files: FileMap; path: string } | null>(null);
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [saving, setSaving] = useState(false);
  const [secretNames, setSecretNames] = useState<string[]>([]);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [cloudVersion, setCloudVersion] = useState(0);

  const [planning, setPlanning] = useState<PlanningState | null>(null);
  const [secretsModal, setSecretsModal] = useState<{ open: boolean; requests: SecretRequest[] }>({
    open: false,
    requests: [],
  });

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const autoSentRef = useRef(false);
  const filesRef = useRef(files);
  filesRef.current = files;
  const nameRef = useRef(projectName);
  nameRef.current = projectName;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const chatIdRef = useRef(activeChatId);
  chatIdRef.current = activeChatId;
  const secretNamesRef = useRef(secretNames);
  secretNamesRef.current = secretNames;
  const cloudRef = useRef(cloud);
  cloudRef.current = cloud;
  const historyRef = useRef(history);
  historyRef.current = history;

  const userId = user?.id;
  const persisted = savedSnapshot !== "";
  const dirty = useMemo(
    () => snapshotOf(projectName, files) !== savedSnapshot,
    [projectName, files, savedSnapshot],
  );
  const fileCount = Object.keys(files).length;
  const previewCloud = useMemo(
    () =>
      projectId && cloud?.enabled
        ? {
            projectId,
            apiKey: cloud.backend === "codzer" ? cloud.apiKey : "",
            supabase:
              cloud.backend === "supabase" && cloud.supabaseUrl
                ? { url: cloud.supabaseUrl, key: cloud.supabaseKey }
                : null,
            version: cloudVersion,
          }
        : null,
    [projectId, cloud, cloudVersion],
  );
  const busy = streaming || planning !== null;

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("bolt_theme", next);
    document.documentElement.setAttribute("data-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  const resetWorkspace = useCallback(() => {
    setMessages([]);
    setFiles({});
    setLive(null);
    setProjectId("");
    setProjectName(DEFAULT_PROJECT_NAME);
    setSavedSnapshot("");
    setSecretNames([]);
    setCloud(null);
    setActiveChatId("");
  }, []);

  const loadHistory = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("chats")
      .select("id, url_id, description, provider, model, messages, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (!error && data) {
      setHistory(
        data.map((row) => ({
          ...row,
          provider: (row.provider as ProviderId) || "lovable",
          messages: Array.isArray(row.messages) ? (row.messages as unknown as ChatMessage[]) : [],
        })),
      );
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user)
      void navigate({ to: "/auth", search: { mode: "signin" }, replace: true });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const refreshSecrets = useCallback(
    async (id: string) => {
      try {
        const result = await listSecrets({ data: { projectId: id, action: "list" } });
        setSecretNames(result.keys.map((key) => key.name));
      } catch {
        setSecretNames([]);
      }
    },
    [listSecrets],
  );

  const refreshCloud = useCallback(
    async (id: string) => {
      try {
        setCloud((await cloudFn({ data: { projectId: id, action: "status" } })).status);
      } catch {
        setCloud(null);
      }
    },
    [cloudFn],
  );

  // Open a saved conversation, preferring the saved project files (which keep manual edits) over chat artifacts.
  useEffect(() => {
    if (!userId || !chatId || chatId === "new") {
      resetWorkspace();
      return;
    }
    let cancelled = false;
    setActiveChatId(chatId);
    void (async () => {
      const { data } = await supabase.from("chats").select("*").eq("id", chatId).maybeSingle();
      if (cancelled || !data) return;
      const loaded = Array.isArray(data.messages)
        ? (data.messages as unknown as ChatMessage[])
        : [];
      setMessages(loaded);
      setProvider((data.provider as ProviderId) || "lovable");
      setModel(data.model || "openai/gpt-6.1-terra");

      const linkedId = `proj_${chatId}`;
      const { data: project } = await supabase
        .from("projects")
        .select("id,name")
        .eq("id", linkedId)
        .maybeSingle();
      if (cancelled) return;
      if (project) {
        const { data: rows } = await supabase
          .from("project_files")
          .select("relative_path,content")
          .eq("project_id", project.id);
        if (cancelled) return;
        const loadedFiles: FileMap = Object.fromEntries(
          (rows ?? []).map((row) => [
            row.relative_path,
            {
              path: row.relative_path,
              content: row.content,
              language: inferLanguage(row.relative_path),
            },
          ]),
        );
        setFiles(loadedFiles);
        setProjectId(project.id);
        setProjectName(project.name);
        setSavedSnapshot(snapshotOf(project.name, loadedFiles));
        if (Object.keys(loadedFiles).length) setWorkbenchOpen(true);
        void refreshSecrets(project.id);
        void refreshCloud(project.id);
        return;
      }
      let extracted: FileMap = {};
      for (const message of loaded)
        if (message.role === "assistant")
          extracted = { ...extracted, ...streamedFiles(message.content) };
      setFiles(extracted);
      setProjectId("");
      setSavedSnapshot("");
      setSecretNames([]);
      setCloud(null);
      if (Object.keys(extracted).length) setWorkbenchOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, userId, resetWorkspace, refreshSecrets, refreshCloud]);

  const ensureChatId = useCallback(() => {
    if (chatIdRef.current) return chatIdRef.current;
    const id = newId("chat");
    chatIdRef.current = id;
    setActiveChatId(id);
    return id;
  }, []);

  /** Saves the workspace to the user's project, creating it on first save. Returns the project id. */
  const saveProject = useCallback(
    async (options?: { files?: FileMap; name?: string; silent?: boolean }): Promise<string> => {
      if (!user) throw new Error("Sign in to save a project");
      const current = options?.files ?? filesRef.current;
      const name = (options?.name ?? nameRef.current).trim() || DEFAULT_PROJECT_NAME;
      const id = projectIdRef.current || `proj_${ensureChatId()}`;
      setSaving(true);
      try {
        const entries = Object.values(current);
        const size = (text: string) => new TextEncoder().encode(text).byteLength;
        const now = new Date().toISOString();
        const { error: projectError } = await supabase.from("projects").upsert({
          id,
          owner_id: user.id,
          name,
          total_files: entries.length,
          total_bytes: entries.reduce((sum, file) => sum + size(file.content), 0),
          storage_backend: "database",
          updated_at: now,
        });
        if (projectError) throw projectError;
        projectIdRef.current = id;
        setProjectId(id);
        const { data: previous, error: readError } = await supabase
          .from("project_files")
          .select("id,relative_path")
          .eq("project_id", id);
        if (readError) throw readError;
        if (entries.length) {
          const { error: fileError } = await supabase.from("project_files").upsert(
            entries.map((file) => ({
              id: `${id}:${file.path}`,
              owner_id: user.id,
              project_id: id,
              relative_path: file.path,
              content: file.content,
              mime_type: "text/plain",
              size_bytes: size(file.content),
              storage_location: "database",
              updated_at: now,
            })),
          );
          if (fileError) throw fileError;
        }
        const obsolete = (previous ?? [])
          .filter((file) => !current[file.relative_path])
          .map((file) => file.id);
        if (obsolete.length) {
          const { error } = await supabase.from("project_files").delete().in("id", obsolete);
          if (error) throw error;
        }
        setSavedSnapshot(snapshotOf(options?.name ?? nameRef.current, current));
        if (!options?.silent) toast.success("Project saved");
        return id;
      } finally {
        setSaving(false);
      }
    },
    [user, ensureChatId],
  );

  /** Returns the project id, saving first when there are unsaved changes or no project yet. */
  const ensureProject = useCallback(async () => {
    const unsaved = snapshotOf(nameRef.current, filesRef.current) !== savedSnapshot;
    if (projectIdRef.current && !unsaved) return projectIdRef.current;
    return saveProject({ silent: true });
  }, [saveProject, savedSnapshot]);

  /** Runs a Cloud Codzer action for this project, saving the project first if it does not exist yet. */
  const runCloud = useCallback(
    async (action: CloudAction) => {
      const id = await ensureProject();
      const result = await cloudFn({ data: { ...action, projectId: id } });
      setCloud(result.status);
      // Restart the preview so the app sees new tables, rules or a changed connection.
      if (!["status", "rows", "users", "files"].includes(action.action))
        setCloudVersion((version) => version + 1);
      return result;
    },
    [ensureProject, cloudFn],
  );

  const persistChat = useCallback(
    async (id: string, nextMessages: ChatMessage[]) => {
      if (!user) return;
      const description =
        historyRef.current.find((chat) => chat.id === id)?.description ??
        (nextMessages[0]?.content ?? "New Chat").slice(0, 80);
      const { error } = await supabase.from("chats").upsert({
        id,
        user_id: user.id,
        url_id: id,
        description,
        provider,
        model,
        messages: nextMessages as unknown as never,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(`Conversation could not be saved: ${error.message}`);
      // Keep the address shareable without remounting the workspace mid-session.
      if (!window.location.pathname.endsWith(`/chat/${id}`))
        window.history.replaceState(window.history.state, "", `/chat/${id}`);
      void loadHistory();
    },
    [user, provider, model, loadHistory],
  );

  const callChat = useCallback(
    (body: Record<string, unknown>, signal: AbortSignal) =>
      fetch("/api/chat", {
        signal,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          provider,
          model,
          secretNames: secretNamesRef.current,
          cloud: {
            backend: cloudRef.current?.backend ?? "codzer",
            tables: cloudRef.current?.tables.map((table) => table.name) ?? [],
          },
          ...body,
        }),
      }),
    [session, provider, model],
  );

  const generate = useCallback(
    async (currentId: string, turnHistory: ChatMessage[], kind: ExecutionMode) => {
      const assistantId = newId("a");
      setMessages([...turnHistory, { id: assistantId, role: "assistant", content: "", kind }]);
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      let accumulated = "";
      let frame = 0;
      let committed = 0;
      let opened = false;

      const flush = () => {
        frame = 0;
        const snapshot = accumulated;
        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantId ? { ...message, content: snapshot } : message,
          ),
        );
        if (kind !== "build") return;
        const partial = streamedFiles(snapshot);
        const paths = Object.keys(partial);
        if (!paths.length) return;
        const complete = streamedFiles(snapshot, true);
        let writing = "";
        for (const path of paths)
          if (!complete[path] || complete[path].content !== partial[path]?.content) writing = path;
        setLive({ files: partial, path: writing });
        if (!opened) {
          opened = true;
          setWorkbenchOpen(true);
          setTab("code");
        }
        const done = Object.keys(complete).length;
        if (done > committed) {
          committed = done;
          // Only finished files reach the preview, so half-written scripts never run.
          setFiles((previous) => ({ ...previous, ...complete }));
        }
      };

      const finish = async (aborted: boolean) => {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        const finalMessages: ChatMessage[] = accumulated
          ? [...turnHistory, { id: assistantId, role: "assistant", content: accumulated, kind }]
          : turnHistory;
        setMessages(finalMessages);
        setLive(null);
        const produced = kind === "build" ? streamedFiles(accumulated, aborted) : {};
        let nextFiles = filesRef.current;
        let nextName = nameRef.current;
        if (Object.keys(produced).length) {
          nextFiles = { ...filesRef.current, ...produced };
          setFiles(nextFiles);
          const title = parseArtifactsFromText(accumulated).artifacts[0]?.title;
          if (title && nextName === DEFAULT_PROJECT_NAME) {
            nextName = title.slice(0, 80);
            setProjectName(nextName);
          }
          setWorkbenchOpen(true);
          if (Object.keys(nextFiles).some((path) => /\.html?$/i.test(path))) setTab("preview");
        }
        try {
          await persistChat(currentId, finalMessages);
          if (Object.keys(produced).length)
            await saveProject({ files: nextFiles, name: nextName, silent: true });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Save failed");
        }
        if (!aborted) {
          const requests = extractSecretRequests(accumulated).filter(
            (request) => !secretNamesRef.current.includes(request.name),
          );
          if (requests.length) setSecretsModal({ open: true, requests });
          const tables = extractCloudSchema(accumulated);
          if (tables.length && cloudRef.current?.backend !== "supabase") {
            try {
              await runCloud({ action: "applySchema", tables });
              toast.success(
                `Cloud database ready: ${tables.map((table) => table.name).join(", ")}`,
              );
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : "Could not set up the Cloud database",
              );
            }
          }
        }
      };

      try {
        const response = await callChat(
          {
            messages: toApiMessages(turnHistory),
            files: Object.values(filesRef.current).map(({ path, content }) => ({
              path,
              content: content.slice(0, 200000),
            })),
            mode: kind,
          },
          controller.signal,
        );
        if (!response.ok || !response.body) {
          const failure = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(failure.error || `Request failed (${response.status})`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          if (!frame) frame = requestAnimationFrame(flush);
        }
        await finish(false);
      } catch (error) {
        if (!controller.signal.aborted)
          toast.error(error instanceof Error ? error.message : "Failed to send message");
        await finish(true);
      } finally {
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [callChat, persistChat, saveProject, runCloud],
  );

  const discover = useCallback(
    async (currentId: string, turnHistory: ChatMessage[], text: string) => {
      setPlanning({ loading: true, questions: [], history: turnHistory, chatId: currentId, text });
      const controller = new AbortController();
      abortRef.current = controller;
      let questions: PlanningQuestion[] | null = null;
      try {
        const response = await callChat(
          { messages: toApiMessages(turnHistory), mode: "plan", phase: "questions" },
          controller.signal,
        );
        if (response.ok) questions = parseQuestions(await response.text());
      } catch {
        if (controller.signal.aborted) return;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
      if (controller.signal.aborted) return;
      if (questions) {
        setPlanning({ loading: false, questions, history: turnHistory, chatId: currentId, text });
      } else {
        setPlanning(null);
        await generate(currentId, turnHistory, "plan");
      }
    },
    [callChat, generate],
  );

  const sendMessage = useCallback(
    async (textOverride?: string, modeOverride?: ExecutionMode) => {
      const text = (textOverride ?? input).trim();
      if (!text || streaming || planning || !session?.access_token) return;
      const turnMode = modeOverride ?? mode;
      const currentId = ensureChatId();
      const turnHistory: ChatMessage[] = [
        ...messages,
        { id: newId("u"), role: "user", content: text },
      ];
      setMessages(turnHistory);
      setInput("");
      if (turnMode === "plan") await discover(currentId, turnHistory, text);
      else await generate(currentId, turnHistory, "build");
    },
    [input, streaming, planning, session, mode, messages, ensureChatId, discover, generate],
  );

  const submitAnswers = (answers: PlanningAnswer[]) => {
    if (!planning) return;
    const { history: turnHistory, chatId: currentId } = planning;
    setPlanning(null);
    const withAnswers: ChatMessage[] = answers.length
      ? [
          ...turnHistory,
          {
            id: newId("u"),
            role: "user",
            content: `My answers:\n${answers.map((item) => `• ${item.question}\n   → ${item.answer}`).join("\n")}`,
          },
        ]
      : turnHistory;
    setMessages(withAnswers);
    void generate(currentId, withAnswers, "plan");
  };

  const cancelPlanning = useCallback(() => {
    abortRef.current?.abort();
    setPlanning((current) => {
      if (current) {
        setMessages(current.history.slice(0, -1));
        setInput(current.text);
      }
      return null;
    });
  }, []);

  const buildPlan = useCallback(() => {
    setMode("build");
    void sendMessage("Build the project now, following the approved plan above.", "build");
  }, [sendMessage]);

  const openWorkbench = useCallback(() => setWorkbenchOpen(true), []);
  const openSecrets = useCallback(
    (requests: SecretRequest[]) => setSecretsModal({ open: true, requests }),
    [],
  );

  useEffect(() => {
    if (initialPrompt && session?.access_token && !autoSentRef.current) {
      autoSentRef.current = true;
      void sendMessage(initialPrompt);
    }
  }, [initialPrompt, session, sendMessage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: streaming ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, streaming]);

  const handleEnhance = async () => {
    if (!input.trim() || enhancing || !session?.access_token) return;
    setEnhancing(true);
    try {
      const response = await fetch("/api/enhancer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ message: input.trim() }),
      });
      const data = (await response.json()) as { enhanced?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Enhance failed");
      if (data.enhanced) setInput(data.enhanced);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not enhance prompt");
    } finally {
      setEnhancing(false);
    }
  };

  const startNewChat = () => {
    resetWorkspace();
    chatIdRef.current = "";
    setWorkbenchOpen(false);
    setSidebarOpen(false);
    void navigate({ to: "/chat" });
  };

  const handleDeleteChat = async (id: string) => {
    if (
      busy ||
      !(await confirmDialog({
        title: "Delete this conversation?",
        description: "This cannot be undone.",
        confirmLabel: "Delete conversation",
        danger: true,
      }))
    )
      return;
    const { error } = await supabase.from("chats").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setHistory((previous) => previous.filter((chat) => chat.id !== id));
    if (activeChatId === id) startNewChat();
    toast.success("Chat deleted");
  };

  const renameChat = async (item: ChatSession) => {
    const description = await promptDialog({
      title: "Rename conversation",
      label: "Conversation name",
      defaultValue: item.description,
      confirmLabel: "Rename",
    });
    if (!description) return;
    const { error } = await supabase
      .from("chats")
      .update({ description: description.slice(0, 80) })
      .eq("id", item.id);
    if (error) toast.error(error.message);
    else
      setHistory((previous) =>
        previous.map((chat) =>
          chat.id === item.id ? { ...chat, description: description.slice(0, 80) } : chat,
        ),
      );
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const lastMessageId = messages.at(-1)?.id;
  const headerButton =
    "inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex xl:static xl:inset-auto">
          <aside className="flex h-full w-72 flex-col border-r border-border bg-sidebar">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <BrandLogo showSub />
            </div>
            <div className="p-3">
              <Button className="w-full" size="sm" disabled={busy} onClick={startNewChat}>
                <Plus /> New chat
              </Button>
            </div>
            <div className="thin-scroll flex-1 overflow-y-auto px-2 pb-4">
              <label className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  aria-label="Search conversations"
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Search conversations"
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                />
              </label>
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Recent
              </div>
              {history.length === 0 ? (
                <p className="px-2 py-4 text-xs text-muted-foreground">
                  No saved conversations yet.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {history
                    .filter((item) =>
                      item.description.toLowerCase().includes(historySearch.toLowerCase()),
                    )
                    .map((item) => (
                      <li
                        key={item.id}
                        className={`group flex items-center rounded-lg pl-2.5 pr-1 text-xs transition-colors ${
                          activeChatId === item.id
                            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                            : "text-sidebar-foreground hover:bg-secondary/70"
                        }`}
                      >
                        <Link
                          to="/chat/$id"
                          params={{ id: item.id }}
                          dir="auto"
                          className="min-w-0 flex-1 truncate py-2"
                          onClick={(event) => {
                            if (busy) event.preventDefault();
                            else setSidebarOpen(false);
                          }}
                        >
                          {item.description || "Untitled chat"}
                        </Link>
                        <button
                          type="button"
                          aria-label="Rename conversation"
                          title="Rename"
                          disabled={busy}
                          onClick={() => void renameChat(item)}
                          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete conversation"
                          title="Delete"
                          onClick={() => void handleDeleteChat(item.id)}
                          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
            <div className="space-y-0.5 border-t border-border p-3">
              {isAdmin && (
                <Link
                  to="/admin/storage"
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium hover:bg-secondary"
                >
                  <Shield className="size-3.5 text-primary" /> Admin storage
                </Link>
              )}
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium hover:bg-secondary"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-brand-accent-soft text-primary">
                  <UserIcon className="size-3.5" />
                </span>
                <span className="truncate">
                  {profile?.display_name || user?.email || "Account"}
                </span>
              </button>
            </div>
          </aside>
          <div
            className="flex-1 bg-background/70 backdrop-blur-sm xl:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/90 px-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label="Toggle sidebar"
              className={headerButton}
            >
              <Menu className="size-4" />
            </button>
            <Link to="/" className="hidden sm:inline-flex">
              <BrandLogo />
            </Link>
            {fileCount > 0 && (
              <span
                dir="auto"
                className="ml-2 hidden max-w-48 truncate rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs text-muted-foreground md:inline"
              >
                {projectName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={headerButton}
              title="Export conversation"
              aria-label="Export conversation"
              disabled={!messages.length || busy}
              onClick={() =>
                downloadFile(
                  "whiterchat-conversation.md",
                  conversationMarkdown(messages),
                  "text/markdown",
                )
              }
            >
              <Download className="size-4" />
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              title="Toggle theme"
              className={headerButton}
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <Button
              variant={workbenchOpen ? "secondary" : "outline"}
              size="sm"
              className="ml-1"
              onClick={() => setWorkbenchOpen((open) => !open)}
            >
              <PanelRightOpen className="text-primary" />
              Workbench
              {fileCount > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                  {fileCount}
                </span>
              )}
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="thin-scroll flex-1 overflow-y-auto px-4 py-6">
              <div className="mx-auto max-w-3xl space-y-6">
                {messages.length === 0 ? (
                  <div className="pt-[8vh] text-center">
                    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                      <span className="size-1.5 rounded-full bg-success" /> Live code · Preview ·
                      Cloud terminal
                    </span>
                    <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
                      What do you want to <span className="text-gradient">build?</span>
                    </h1>
                    <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                      Describe an app and watch the code appear line by line. Switch to Plan to be
                      asked a few questions first.
                    </p>
                    <div className="mx-auto mt-8 grid max-w-2xl gap-2 text-left sm:grid-cols-2">
                      {SUGGESTIONS.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => setInput(suggestion)}
                          className="rounded-xl border border-border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground transition-all hover:border-primary/50 hover:text-foreground hover:shadow-glow"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((message) => (
                    <ChatMessageItem
                      key={message.id}
                      message={message}
                      active={
                        streaming && message.id === lastMessageId && message.role === "assistant"
                      }
                      busy={busy}
                      livePath={live?.path ?? ""}
                      savedSecrets={secretNames}
                      onOpenWorkbench={openWorkbench}
                      onBuildPlan={buildPlan}
                      onOpenSecrets={openSecrets}
                    />
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="px-4 pb-4 pt-1">
              <div className="relative mx-auto max-w-3xl">
                {planning && (
                  <PlanningModal
                    loading={planning.loading}
                    questions={planning.questions}
                    onCancel={cancelPlanning}
                    onSubmit={submitAnswers}
                  />
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendMessage();
                  }}
                  className={`prompt-shell relative rounded-2xl p-2 ${planning ? "z-50" : ""}`}
                >
                  <textarea
                    rows={2}
                    dir="auto"
                    value={input}
                    disabled={planning !== null}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    placeholder={
                      mode === "plan"
                        ? "Describe your idea — I will ask a few questions, then write a plan"
                        : "Describe what to build or change…"
                    }
                    className="max-h-48 w-full resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
                    <div className="flex items-center gap-1.5">
                      <div
                        role="radiogroup"
                        aria-label="Mode"
                        className="flex items-center rounded-lg bg-muted p-0.5"
                      >
                        {(
                          [
                            ["build", "Build", Hammer],
                            ["plan", "Plan", ListChecks],
                          ] as const
                        ).map(([id, label, Icon]) => (
                          <button
                            key={id}
                            type="button"
                            role="radio"
                            aria-checked={mode === id}
                            disabled={busy}
                            onClick={() => setMode(id)}
                            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                              mode === id
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <Icon className={`size-3.5 ${mode === id ? "text-primary" : ""}`} />{" "}
                            {label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={enhancing || !input.trim() || busy}
                        onClick={() => void handleEnhance()}
                        title="Improve my prompt"
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
                      >
                        {enhancing ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="size-3.5" />
                        )}
                        <span className="hidden sm:inline">Enhance</span>
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <ModelSelector
                        provider={provider}
                        model={model}
                        onSelect={(nextProvider, nextModel) => {
                          setProvider(nextProvider);
                          setModel(nextModel);
                        }}
                      />
                      {streaming ? (
                        <button
                          type="button"
                          title="Stop generating"
                          aria-label="Stop generating"
                          onClick={() => abortRef.current?.abort()}
                          className="inline-flex size-8 items-center justify-center rounded-lg bg-foreground text-background transition-opacity hover:opacity-85"
                        >
                          <Square className="size-3.5 fill-current" />
                        </button>
                      ) : (
                        <button
                          type="submit"
                          aria-label="Send"
                          disabled={!input.trim() || planning !== null}
                          className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-glow transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:shadow-none"
                        >
                          <ArrowUp className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </main>

          {workbenchOpen && (
            <div className="fixed inset-x-0 bottom-0 top-14 z-30 bg-background lg:static lg:z-auto lg:w-[56%] lg:shrink-0">
              <WorkbenchPanel
                files={files}
                liveFiles={live?.files ?? null}
                livePath={live?.path ?? ""}
                streaming={streaming}
                tab={tab}
                onTabChange={setTab}
                projectId={projectId}
                projectName={projectName}
                onRename={setProjectName}
                dirty={dirty}
                saving={saving}
                persisted={persisted}
                secretCount={secretNames.length}
                onSave={() =>
                  void saveProject().catch((error: unknown) =>
                    toast.error(
                      error instanceof Error ? error.message : "Save failed; please try again",
                    ),
                  )
                }
                ensureProject={ensureProject}
                onReplaceFiles={setFiles}
                onUpdateFile={(path, content) =>
                  setFiles((previous) => ({
                    ...previous,
                    [path]: {
                      ...(previous[path] ?? { path, language: inferLanguage(path) }),
                      content,
                    },
                  }))
                }
                onLoadProject={(id, name, next) => {
                  projectIdRef.current = id;
                  setProjectId(id);
                  setProjectName(name);
                  setFiles(next);
                  setSavedSnapshot(snapshotOf(name, next));
                  setTab("preview");
                  void refreshSecrets(id);
                  void refreshCloud(id);
                }}
                onOpenSecrets={() => setSecretsModal({ open: true, requests: [] })}
                cloud={cloud}
                previewCloud={previewCloud}
                runCloud={runCloud}
                onClose={() => setWorkbenchOpen(false)}
              />
            </div>
          )}
        </div>
      </div>

      <ProjectSecretsModal
        open={secretsModal.open}
        requests={secretsModal.requests}
        ensureProject={ensureProject}
        onClose={() => setSecretsModal((current) => ({ ...current, open: false }))}
        onKeysChanged={setSecretNames}
      />

      <ProfileModal
        isOpen={profileOpen}
        profile={profile}
        onClose={() => setProfileOpen(false)}
        onSaved={() => void refreshProfile()}
        onSignOut={async () => {
          await signOut();
          setProfileOpen(false);
          void navigate({ to: "/" });
        }}
      />
    </div>
  );
}
