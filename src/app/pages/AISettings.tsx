import { useState, useEffect } from "react";
import { PageLayout } from "../components/PageLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Bot, Eye, EyeOff, CheckCircle2, XCircle, Loader2, ChevronLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { apiUrl } from "../lib/api";

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)", models: [
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — fast & cheap (recommended)" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — smarter, slower" },
  ]},
  { value: "openai", label: "OpenAI (ChatGPT)", models: [
    { value: "gpt-4o-mini", label: "GPT-4o Mini — fast & cheap (recommended)" },
    { value: "gpt-4o", label: "GPT-4o — smarter, slower" },
  ]},
  { value: "gemini", label: "Google Gemini", models: [
    { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite — lightest, most free quota (recommended)" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash — smarter, good free quota" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash — legacy" },
  ]},
  { value: "groq", label: "Groq (Llama)", models: [
    { value: "llama-3.1-70b-versatile", label: "Llama 3.1 70B — fastest inference (recommended)" },
    { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B — latest" },
  ]},
];

type TestStatus = "idle" | "testing" | "ok" | "fail";

export function AISettings() {
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-haiku-4-5-20251001");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const currentProvider = PROVIDERS.find(p => p.value === provider) ?? PROVIDERS[0];

  useEffect(() => {
    fetch(apiUrl("/api/ai-settings"))
      .then(r => r.json())
      .then(data => {
        if (data.provider) setProvider(data.provider);
        if (data.model) setModel(data.model);
        setHasExistingKey(data.has_key ?? false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Reset model to first option when provider changes
  const handleProviderChange = (p: string) => {
    setProvider(p);
    const prov = PROVIDERS.find(x => x.value === p);
    if (prov) setModel(prov.models[0].value);
    setTestStatus("idle");
    setTestError("");
  };

  const handleTest = async () => {
    if (!apiKey && !hasExistingKey) {
      setTestError("Enter an API key first");
      setTestStatus("fail");
      return;
    }
    setTestStatus("testing");
    setTestError("");
    try {
      const resp = await fetch(apiUrl("/api/ai-settings/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, api_key: apiKey || undefined }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setTestStatus("ok");
      } else {
        setTestStatus("fail");
        setTestError(data.error ?? "Connection failed");
      }
    } catch {
      setTestStatus("fail");
      setTestError("Network error");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const body: Record<string, string> = { provider, model };
      if (apiKey) body.api_key = apiKey;
      const resp = await fetch(apiUrl("/api/ai-settings"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        setSaved(true);
        if (apiKey) setHasExistingKey(true);
        setApiKey("");
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {}
    finally { setSaving(false); }
  };

  if (loading) return (
    <PageLayout title="AI Assistant Settings">
      <div className="flex items-center gap-2 text-muted-foreground p-8"><Loader2 className="size-4 animate-spin" /> Loading…</div>
    </PageLayout>
  );

  return (
    <PageLayout title="AI Assistant Settings">
      <div className="max-w-2xl space-y-6">
        <Link to="/configuration" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3.5" /> Back to Configuration
        </Link>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4 text-primary" />
              AI Provider
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Choose the AI service that powers the WFM assistant chat panel. You can switch providers at any time without losing your chat history.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Provider */}
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-foreground/60">Provider</Label>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDERS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => handleProviderChange(p.value)}
                    className={`px-4 py-2.5 rounded-lg border text-sm font-medium text-left transition-all ${
                      provider === p.value
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Model */}
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-foreground/60">Model</Label>
              <div className="space-y-1.5">
                {currentProvider.models.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setModel(m.value)}
                    className={`w-full px-4 py-2.5 rounded-lg border text-sm text-left transition-all ${
                      model === m.value
                        ? "border-primary bg-primary/5 text-primary font-medium"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <Label htmlFor="apiKey" className="text-xs font-black uppercase tracking-widest text-foreground/60">
                API Key {hasExistingKey && !apiKey && <span className="text-emerald-600 font-normal normal-case tracking-normal ml-1">— key saved ✓</span>}
              </Label>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setTestStatus("idle"); }}
                  placeholder={hasExistingKey ? "Enter new key to replace existing…" : `Paste your ${currentProvider.label} API key…`}
                  className="pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Your key is stored in the database and never exposed to the browser after saving.
              </p>
            </div>

            {/* Test + Status */}
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testStatus === "testing"}
                className="gap-2"
              >
                {testStatus === "testing" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Test Connection
              </Button>
              {testStatus === "ok" && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                  <CheckCircle2 className="size-4" /> Connection successful
                </span>
              )}
              {testStatus === "fail" && (
                <span className="flex items-center gap-1.5 text-sm text-rose-600 font-medium">
                  <XCircle className="size-4" /> {testError || "Connection failed"}
                </span>
              )}
            </div>

            {/* Save */}
            <div className="pt-2 border-t border-border flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Save Settings
              </Button>
              {saved && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                  <CheckCircle2 className="size-4" /> Saved
                </span>
              )}
            </div>

          </CardContent>
        </Card>

        {/* Info card */}
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Where to get an API key:</strong>{" "}
              {provider === "anthropic" && "console.anthropic.com → API Keys"}
              {provider === "openai" && "platform.openai.com → API Keys"}
              {provider === "gemini" && "aistudio.google.com → Get API Key"}
              {provider === "groq" && "console.groq.com → API Keys"}
              . The assistant uses your key for every chat message, so make sure it has sufficient quota.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
