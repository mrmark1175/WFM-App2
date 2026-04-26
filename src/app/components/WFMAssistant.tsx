import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Send, X, ChevronRight, Loader2, RotateCcw, Settings } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { apiUrl } from "../lib/api";
import { useWFMPageData } from "../lib/WFMPageDataContext";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const PAGE_STARTERS: Record<string, string[]> = {
  "/wfm/long-term-forecasting-demand": [
    "What's the difference between blended and dedicated staffing pools?",
    "How should I interpret the seasonality index chart?",
    "My FTE looks too high — what parameters should I review first?",
    "Explain the growth rate setting and when to use it",
  ],
  "/wfm/capacity": [
    "Walk me through how Erlang C is applied here",
    "What occupancy level should I target for my team?",
    "Why does adding agents have diminishing returns on SLA?",
    "How do I size for chat with concurrency?",
  ],
  "/wfm/shrinkage": [
    "What's a realistic total shrinkage % for a BPO?",
    "Should I include training shrinkage in my FTE gross-up?",
    "How does shrinkage compound with occupancy?",
    "Explain the difference between planned and unplanned shrinkage",
  ],
  "/wfm/intraday": [
    "Why do I need more agents than my average interval FTE?",
    "What does the smoothing toggle do to my staffing plan?",
    "How should I handle the lunch-hour volume spike?",
    "When is 15-min interval better than 30-min for planning?",
  ],
  "/scheduling": [
    "What are the key scheduling constraints I should define?",
    "How do I balance shift coverage with agent preferences?",
    "Explain the relationship between shrinkage and scheduled FTE",
    "What's a good starting point for shift window design?",
  ],
};

const DEFAULT_STARTERS = [
  "Explain Erlang C in simple terms",
  "What is shrinkage and how do I calculate it?",
  "How do I set up a WFM planning cycle?",
  "What's the difference between occupancy and utilization?",
];

function getStarters(pathname: string): string[] {
  for (const key of Object.keys(PAGE_STARTERS)) {
    if (pathname.startsWith(key)) return PAGE_STARTERS[key];
  }
  return DEFAULT_STARTERS;
}

function getPageLabel(pathname: string): string {
  if (pathname.startsWith("/wfm/long-term-forecasting-demand")) return "Demand Forecasting";
  if (pathname.startsWith("/wfm/capacity")) return "Capacity Planning";
  if (pathname.startsWith("/wfm/shrinkage")) return "Shrinkage Planning";
  if (pathname.startsWith("/wfm/intraday")) return "Intraday Forecast";
  if (pathname.startsWith("/scheduling")) return "Scheduling";
  return "WFM";
}

interface WFMAssistantProps {
  open: boolean;
  onToggle: () => void;
}

export function WFMAssistant({ open, onToggle }: WFMAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();

  const starters = getStarters(location.pathname);
  const pageLabel = getPageLabel(location.pathname);
  const { pageData, pendingPrompt, setPendingPrompt } = useWFMPageData();

  useEffect(() => {
    fetch(apiUrl("/api/ai-settings"))
      .then(r => r.json())
      .then(d => setConfigured(d.has_key === true))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Auto-fire a prompt injected by a page-level "Ask Mark" button
  useEffect(() => {
    if (!open || !pendingPrompt) return;
    const prompt = pendingPrompt;
    setPendingPrompt(null);
    // Small delay so the panel finishes opening before we start streaming
    const t = setTimeout(() => sendMessage(prompt), 150);
    return () => clearTimeout(t);
  }, [open, pendingPrompt]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;
    const userMsg: Message = { role: "user", content: text.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);

    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages(prev => [...prev, assistantMsg]);

    // Inject page data only on the first message — once it's in conversation
    // history the AI retains it without re-sending on every subsequent turn.
    const isFirstMessage = messages.length === 0;
    let apiMessages: Message[] = nextMessages;
    if (isFirstMessage && pageData) {
      const prefix = `[Live page data — ${pageLabel}]\n${JSON.stringify(pageData, null, 2)}\n\n---\n`;
      apiMessages = [{ role: "user", content: prefix + text.trim() }];
    }

    try {
      const resp = await fetch(apiUrl("/api/ai/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          pageContext: { page: pageLabel, path: location.pathname },
        }),
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: `⚠ ${err.error ?? "Request failed"}` };
          return copy;
        });
        setStreaming(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              setMessages(prev => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: `⚠ ${parsed.error}` };
                return copy;
              });
            } else if (parsed.text) {
              setMessages(prev => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                copy[copy.length - 1] = { ...last, content: last.content + parsed.text };
                return copy;
              });
            }
          } catch {}
        }
      }
    } catch (err) {
      setMessages(prev => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: "⚠ Network error. Please try again." };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }, [messages, streaming, pageLabel, location.pathname, pageData]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // Collapsed tab
  if (!open) {
    return (
      <div className="fixed right-0 top-1/2 -translate-y-1/2 z-30">
        <button
          onClick={onToggle}
          className="flex flex-col items-center gap-1.5 bg-[#1111D4] text-white px-2 py-4 rounded-l-lg shadow-lg hover:bg-[#0d0db8] transition-colors"
          title="Ask Mark"
        >
          <Bot className="size-4" />
          <span className="text-[10px] font-black uppercase tracking-widest [writing-mode:vertical-lr] rotate-180">Ask Mark</span>
          <ChevronRight className="size-3.5 opacity-70" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-white border-l border-border h-full w-[320px] shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#1111D4] text-white shrink-0">
        <Bot className="size-4 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold leading-none">Mark</div>
          <div className="text-[10px] text-white/70 mt-0.5 truncate">WFM Manager · {pageLabel}</div>
        </div>
        <Link to="/configuration/ai-settings" title="AI Settings" className="text-white/70 hover:text-white transition-colors">
          <Settings className="size-3.5" />
        </Link>
        <button onClick={onToggle} className="text-white/70 hover:text-white transition-colors ml-1" title="Close">
          <X className="size-4" />
        </button>
      </div>

      {/* Not configured banner */}
      {configured === false && (
        <div className="mx-3 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <strong>API key not configured.</strong> Add your key in{" "}
          <Link to="/configuration/ai-settings" className="underline font-medium">Configuration → AI Assistant</Link>{" "}
          to start chatting.
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="size-6 rounded-full bg-[#1111D4] flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="size-3.5 text-white" />
              </div>
              <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-foreground max-w-[220px]">
                Hi! I'm Mark, your WFM Manager. Ask me anything about staffing, forecasting, scheduling, or Erlang math.
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1 mb-2">
                Suggested for {pageLabel}
              </p>
              <div className="space-y-1.5">
                {starters.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => sendMessage(s)}
                    disabled={streaming || configured === false}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-all text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex items-start gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            {msg.role === "assistant" && (
              <div className="size-6 rounded-full bg-[#1111D4] flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="size-3.5 text-white" />
              </div>
            )}
            <div className={`rounded-2xl px-3 py-2 text-sm max-w-[230px] whitespace-pre-wrap leading-relaxed ${
              msg.role === "user"
                ? "bg-[#1111D4] text-white rounded-tr-sm"
                : "bg-muted text-foreground rounded-tl-sm"
            }`}>
              {msg.content}
              {msg.role === "assistant" && streaming && i === messages.length - 1 && (
                <span className="inline-block w-1.5 h-3.5 bg-current opacity-70 ml-0.5 animate-pulse rounded-sm" />
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Clear button when there are messages */}
      {messages.length > 0 && (
        <div className="px-3 pb-1 shrink-0">
          <button
            type="button"
            onClick={() => setMessages([])}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="size-3" /> New conversation
          </button>
        </div>
      )}

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-border shrink-0">
        <div className="flex items-end gap-2 bg-muted rounded-xl px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={configured === false ? "Configure API key first…" : "Ask Mark anything…"}
            disabled={streaming || configured === false}
            rows={1}
            className="flex-1 bg-transparent text-sm resize-none outline-none max-h-28 leading-relaxed placeholder:text-muted-foreground disabled:cursor-not-allowed"
            style={{ minHeight: "20px" }}
          />
          <button
            type="button"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || streaming || configured === false}
            className="shrink-0 size-7 rounded-lg bg-[#1111D4] text-white flex items-center justify-center hover:bg-[#0d0db8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {streaming ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 px-1">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
