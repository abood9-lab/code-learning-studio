import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ListChecks, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanningQuestion } from "@/lib/workspace-protocol";

export interface PlanningAnswer {
  question: string;
  answer: string;
}

interface PlanningModalProps {
  loading: boolean;
  questions: PlanningQuestion[];
  onCancel: () => void;
  onSubmit: (answers: PlanningAnswer[]) => void;
}

/** Discovery sheet that rises out of the prompt box: one question at a time, then hands the answers back. */
export function PlanningModal({ loading, questions, onCancel, onSubmit }: PlanningModalProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const total = questions.length;
  const current = questions[step];
  const value = (custom[step] ?? "").trim() || answers[step] || "";
  const isLast = step === total - 1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  useEffect(() => {
    panelRef.current?.focus();
  }, [loading]);

  useEffect(() => {
    if (current && current.options.length === 0) inputRef.current?.focus();
  }, [current]);

  const finish = () => {
    const collected = questions
      .map((question, index) => ({
        question: question.question,
        answer: (custom[index] ?? "").trim() || answers[index] || "",
      }))
      .filter((item) => item.answer);
    onSubmit(collected);
  };

  const next = () => {
    if (isLast) finish();
    else setStep((index) => index + 1);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <section
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Plan questions"
        className="sheet-rise absolute inset-x-0 bottom-full z-50 mb-3 flex max-h-[min(34rem,70dvh)] flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-elevated outline-none"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-brand-accent-soft text-primary">
              <ListChecks className="size-4.5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold leading-tight">A few quick questions</h2>
              <p className="text-xs text-muted-foreground">
                {loading
                  ? "Reading your idea…"
                  : `So the plan fits exactly what you want · ${step + 1} of ${total}`}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Cancel planning" onClick={onCancel}>
            <X />
          </Button>
        </header>

        {loading || !current ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Preparing questions tailored to your project…
            </p>
          </div>
        ) : (
          <>
            <div className="flex gap-1.5 px-5 pt-4" aria-hidden="true">
              {questions.map((_, index) => (
                <span
                  key={index}
                  className={`h-1 flex-1 rounded-full transition-colors ${index <= step ? "bg-primary" : "bg-muted"}`}
                />
              ))}
            </div>

            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5" key={step}>
              <h3 dir="auto" className="text-lg font-semibold leading-snug tracking-tight">
                {current.question}
              </h3>

              {current.options.length > 0 && (
                <div
                  className="mt-4 grid gap-2 sm:grid-cols-2"
                  role="radiogroup"
                  aria-label={current.question}
                >
                  {current.options.map((option) => {
                    const selected = answers[step] === option && !(custom[step] ?? "").trim();
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        dir="auto"
                        onClick={() => {
                          setAnswers((previous) => ({ ...previous, [step]: option }));
                          setCustom((previous) => ({ ...previous, [step]: "" }));
                        }}
                        className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-start text-sm transition-all ${
                          selected
                            ? "border-primary bg-brand-accent-soft font-medium text-foreground shadow-glow"
                            : "border-border bg-card hover:border-primary/50 hover:bg-secondary"
                        }`}
                      >
                        <span>{option}</span>
                        <span
                          className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border"
                          }`}
                        >
                          {selected && <Check className="size-3" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <label className="mt-4 block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  {current.options.length > 0 ? "Or write your own answer" : "Your answer"}
                </span>
                <textarea
                  ref={inputRef}
                  rows={2}
                  dir="auto"
                  value={custom[step] ?? ""}
                  onChange={(event) =>
                    setCustom((previous) => ({ ...previous, [step]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && value) {
                      event.preventDefault();
                      next();
                    }
                  }}
                  placeholder="Type here…"
                  className="w-full resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
              </label>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-secondary/40 px-5 py-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={step === 0}
                onClick={() => setStep((index) => index - 1)}
              >
                <ArrowLeft /> Back
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={finish}>
                  Skip to plan
                </Button>
                <Button size="sm" disabled={!value} onClick={next}>
                  {isLast ? (
                    <>
                      <Sparkles /> Create plan
                    </>
                  ) : (
                    <>
                      Next <ArrowRight />
                    </>
                  )}
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>
    </>
  );
}
