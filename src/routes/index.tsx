import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUp,
  Check,
  Code2,
  Cpu,
  Eye,
  Hammer,
  KeyRound,
  ListChecks,
  TerminalSquare,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import type { ExecutionMode, ProviderId } from "@/lib/types";
import { BrandLogo } from "@/components/BrandLogo";
import { ModelSelector } from "@/components/ModelSelector";
import { AuthModal } from "@/components/AuthModal";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Whiterchat — Where Ideas Begin" },
      {
        name: "description",
        content:
          "Describe an app and watch the code get written live, with an instant preview, guided planning and a real cloud terminal.",
      },
      { property: "og:title", content: "Whiterchat — Where Ideas Begin" },
      {
        property: "og:description",
        content:
          "Describe an app and watch the code get written live, with an instant preview, guided planning and a real cloud terminal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const FEATURES = [
  {
    icon: Code2,
    title: "Live code",
    text: "Watch each file being typed in real time, and follow along as the app takes shape.",
  },
  {
    icon: ListChecks,
    title: "Guided planning",
    text: "Plan mode asks a few focused questions first, then hands you a clear, structured plan to approve.",
  },
  {
    icon: Eye,
    title: "Instant preview",
    text: "A browser-style preview with phone, tablet and desktop views, a console and full screen.",
  },
  {
    icon: TerminalSquare,
    title: "Cloud terminal",
    text: "Run real commands in a private Linux sandbox attached to your project.",
  },
  {
    icon: KeyRound,
    title: "Safe API keys",
    text: "When a project needs a private key you are asked in a secure window. Keys are encrypted and never shown to the AI.",
  },
  {
    icon: Cpu,
    title: "Your choice of model",
    text: "Use the built-in model or switch to OpenRouter, Groq or Gemini whenever you like.",
  },
];

const STEPS = [
  ["Describe", "Write what you want in plain words, in any language."],
  ["Review", "Answer a few questions, read the plan, and approve it."],
  ["Ship", "Watch it get built, test it in the preview, and download the code."],
] as const;

function Index() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<ProviderId>("lovable");
  const [model, setModel] = useState("openai/gpt-6.1-terra");
  const [mode, setMode] = useState<ExecutionMode>("build");
  const [authModalOpen, setAuthModalOpen] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      const raw = sessionStorage.getItem("pending_prompt");
      if (raw) {
        sessionStorage.removeItem("pending_prompt");
        try {
          const parsed = JSON.parse(raw) as {
            prompt: string;
            provider?: ProviderId;
            model?: string;
            mode?: ExecutionMode;
          };
          void navigate({
            to: "/chat",
            search: {
              prompt: parsed.prompt,
              provider: parsed.provider ?? "lovable",
              model: parsed.model ?? "openai/gpt-6.1-terra",
              mode: parsed.mode ?? "build",
            },
            replace: true,
          });
          return;
        } catch {
          // ignore invalid pending prompt
        }
      }
    }
  }, [loading, user, navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text) return;

    if (!user) {
      sessionStorage.setItem(
        "pending_prompt",
        JSON.stringify({ prompt: text, provider, model, mode }),
      );
      setAuthModalOpen(true);
      return;
    }

    void navigate({
      to: "/chat",
      search: { prompt: text, provider, model, mode },
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link to="/">
            <BrandLogo />
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#product" className="transition-colors hover:text-foreground">
              Product
            </a>
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#how" className="transition-colors hover:text-foreground">
              How it works
            </a>
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <Link
                to="/chat"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-glow transition-colors hover:bg-primary/90"
              >
                Open workspace <ArrowRight className="size-3.5" />
              </Link>
            ) : (
              <>
                <Link
                  to="/auth"
                  search={{ mode: "signin" }}
                  className="px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  Sign in
                </Link>
                <Link
                  to="/auth"
                  search={{ mode: "signup" }}
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-glow transition-colors hover:bg-primary/90"
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="app-backdrop px-5 pb-16 pt-20 sm:pt-28">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" /> Live code · Guided plans · Cloud
            terminal
          </span>
          <h1 className="mt-6 text-5xl font-bold leading-[1.05] tracking-tight sm:text-7xl">
            Say it. <span className="text-gradient">See it built.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
            Describe your app and watch every line appear as it is written — with an instant preview
            and a real terminal beside it.
          </p>

          <form
            onSubmit={handleSubmit}
            className="prompt-shell mx-auto mt-10 max-w-2xl rounded-2xl p-2.5 text-left shadow-elevated"
          >
            <textarea
              rows={3}
              dir="auto"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder={
                mode === "plan"
                  ? "Describe your idea — you will get a few questions, then a plan"
                  : "Describe the app you want to build…"
              }
              className="w-full resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2">
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
                    onClick={() => setMode(id)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      mode === id
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className={`size-3.5 ${mode === id ? "text-primary" : ""}`} /> {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <ModelSelector
                  provider={provider}
                  model={model}
                  onSelect={(p, m) => {
                    setProvider(p);
                    setModel(m);
                  }}
                />
                <button
                  type="submit"
                  aria-label="Start building"
                  disabled={!prompt.trim()}
                  className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-glow transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:shadow-none"
                >
                  <ArrowUp className="size-4" />
                </button>
              </div>
            </div>
          </form>
        </div>

        <div id="product" className="mx-auto mt-20 max-w-5xl scroll-mt-24">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-elevated">
            <div className="flex items-center gap-2 border-b border-border bg-secondary/60 px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-destructive/70" />
              <span className="size-2.5 rounded-full bg-warning/80" />
              <span className="size-2.5 rounded-full bg-success/80" />
              <span className="ml-3 rounded-md border border-border bg-background px-3 py-0.5 font-mono text-[11px] text-muted-foreground">
                whiterchat / workspace
              </span>
            </div>
            <div className="grid md:grid-cols-[1fr_1.35fr]">
              <div className="space-y-3 border-b border-border p-5 text-left md:border-b-0 md:border-r">
                <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-xs text-primary-foreground">
                  A booking page for a coffee shop
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Building a warm, mobile-first booking page with a menu and a reservation form.
                </p>
                <div className="rounded-xl border border-border bg-background p-3 font-mono text-[11px]">
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Check className="size-3 text-success" /> index.html
                  </p>
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Check className="size-3 text-success" /> styles.css
                  </p>
                  <p className="flex items-center gap-2 text-foreground">
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" /> app.js{" "}
                    <span className="text-primary">writing…</span>
                  </p>
                </div>
              </div>
              <div
                className="bg-terminal p-5 text-left font-mono text-[11.5px] leading-6 text-terminal-foreground"
                dir="ltr"
              >
                <p>
                  <span className="text-terminal-muted">12</span> const form =
                  document.querySelector(<span className="text-terminal-accent">"#booking"</span>);
                </p>
                <p>
                  <span className="text-terminal-muted">13</span> form.addEventListener(
                  <span className="text-terminal-accent">"submit"</span>, (event) =&gt; {"{"}
                </p>
                <p>
                  <span className="text-terminal-muted">14</span> event.preventDefault();
                </p>
                <p>
                  <span className="text-terminal-muted">15</span> confirmTable(new FormData(form));
                  <span className="live-caret" />
                </p>
                <div className="mt-4 border-t border-terminal-border pt-3">
                  <p>
                    <span className="text-terminal-accent">~/workspace $</span> npm install
                  </p>
                  <p className="text-terminal-muted">added 42 packages in 3s</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-20 border-t border-border px-5 py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">
            Everything between the idea and the running app.
          </h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <article
                key={title}
                className="rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/40 hover:shadow-glow"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand-accent-soft text-primary">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="scroll-mt-20 border-t border-border bg-secondary/40 px-5 py-24">
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-3">
          {STEPS.map(([title, text], index) => (
            <div key={title}>
              <span className="font-mono text-sm text-primary">0{index + 1}</span>
              <h3 className="mt-3 text-xl font-semibold tracking-tight">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border px-5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <BrandLogo showSub />
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Whiterchat. All rights reserved.
          </p>
        </div>
      </footer>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={() => {
          setAuthModalOpen(false);
          void navigate({ to: "/chat", search: { prompt: prompt.trim(), provider, model, mode } });
        }}
      />
    </div>
  );
}
