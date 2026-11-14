"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import type { AnalysisMode, Focus, ReviewResult } from "@/lib/review/types";
import { ALLOWED_EXTENSIONS, MAX_INPUT_BYTES } from "@/lib/validation/review-input";
import { ResultView } from "./result-view";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false, loading: () => <div className="p-4 muted text-sm">Loading editor…</div> });

type Mode = "paste" | "upload" | "diff";
const FOCUS_LABELS: Record<Focus, string> = {
  general: "General review", bug: "Bug detection", security: "Security", performance: "Performance", maintainability: "Maintainability",
};
const LANGS = ["typescript", "javascript", "python", "go", "rust", "java", "csharp", "cpp", "php", "ruby", "sql", "shell", "html", "css", "json", "yaml"];
const EXT: Record<string, string> = {
  typescript: "ts", javascript: "js", python: "py", go: "go", rust: "rs", java: "java", csharp: "cs", cpp: "cpp", php: "php",
  ruby: "rb", sql: "sql", shell: "sh", html: "html", css: "css", json: "json", yaml: "yml",
};

function detectLanguage(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? (["tsx"].includes(ext) ? "typescript" : ["jsx", "mjs", "cjs"].includes(ext) ? "javascript" : "plaintext");
}

interface Capabilities {
  jevConfigured: boolean;
  claude: { available: true; model: string | null } | { available: false; reason: string };
}

const MODE_INFO: Record<AnalysisMode, { label: string; note: string }> = {
  jev_only: { label: "JEV only", note: "Uses JEV credits only. Findings are region classifications without explanations or fixes." },
  standard: { label: "Standard (JEV + Claude)", note: "Claude validates only the regions JEV flagged and adds explanations and fixes. Skipped when JEV flags nothing. Bounded request count and budget." },
  thorough: { label: "Thorough (independent Claude review)", note: "Claude reads the whole submitted code (or diff) to catch what JEV missed. Uses noticeably more Anthropic tokens; still bounded by the server's request and budget caps." },
};

export function ReviewApp() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisMode>("jev_only");
  const [confirmThorough, setConfirmThorough] = useState(false);
  const submitting = useRef(false);
  const [mode, setMode] = useState<Mode>("paste");
  const [language, setLanguage] = useState("typescript");
  const [focus, setFocus] = useState<Focus>("general");
  const [code, setCode] = useState("");
  const [diff, setDiff] = useState("");
  const [upload, setUpload] = useState<{ name: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/review/capabilities").then((r) => r.json()).then((c: Capabilities) => {
      setCaps(c);
      if (c.claude.available && c.jevConfigured) setAnalysis("standard");
    }).catch(() => setCaps(null));
  }, []);

  const claudeOk = !!caps?.claude.available;
  const content = mode === "paste" ? code : mode === "upload" ? upload?.text ?? "" : diff;
  const bytes = new TextEncoder().encode(content).length;
  const tooBig = bytes > MAX_INPUT_BYTES;

  async function onFile(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (f.size > MAX_INPUT_BYTES) return setError(`File exceeds ${MAX_INPUT_BYTES / 1000} KB.`);
    const text = await f.text();
    if (text.includes("\0")) return setError("Binary files are not supported.");
    setUpload({ name: f.name, text });
  }

  async function submit() {
    if (submitting.current) return; // ignore double clicks: every submit can be billable
    submitting.current = true;
    setError(null);
    setResult(null);
    setLoading(true);
    ctrl.current = new AbortController();
    const timeout = setTimeout(() => ctrl.current?.abort(), 90_000);
    try {
      const filename = mode === "paste" ? `snippet.${EXT[language] ?? "txt"}` : upload?.name ?? "";
      const body = mode === "diff" ? { mode, diff, focus, analysis } : { mode, filename, code: content, focus, analysis };
      const res = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.current.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Review failed.");
      setResult(data);
    } catch (e) {
      setError(e instanceof DOMException && e.name === "AbortError" ? "The review was cancelled or timed out. It may still have been processed; avoid resubmitting repeatedly." : e instanceof Error ? e.message : "Review failed.");
    } finally {
      clearTimeout(timeout);
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="panel p-4 space-y-3" aria-label="Submit code">
        <div className="flex flex-wrap items-center gap-2" role="tablist">
          {(["paste", "upload", "diff"] as Mode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1.5 text-sm ${mode === m ? "bg-[var(--accent)] text-white" : "panel"}`}>
              {m === "paste" ? "Paste code" : m === "upload" ? "Upload file" : "Git diff"}
            </button>
          ))}
          <div className="ml-auto flex gap-2">
            {mode === "paste" && (
              <select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} className="panel px-2 py-1.5 text-sm">
                {LANGS.map((l) => <option key={l}>{l}</option>)}
              </select>
            )}
            <select aria-label="Review focus" value={focus} onChange={(e) => setFocus(e.target.value as Focus)} className="panel px-2 py-1.5 text-sm">
              {Object.entries(FOCUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>

        {mode === "upload" && !upload ? (
          <label className="panel flex cursor-pointer flex-col items-center gap-2 border-dashed p-10 text-sm muted">
            <Upload size={20} />
            <span>Choose a source file (.{ALLOWED_EXTENSIONS.slice(0, 8).join(", .")} and more; max {MAX_INPUT_BYTES / 1000} KB, one file)</span>
            <input type="file" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        ) : (
          <div className="panel overflow-hidden">
            <Monaco height="340px" theme={typeof window !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "vs-dark" : "light"}
              language={mode === "paste" ? language : mode === "diff" ? "diff" : detectLanguage(upload?.name ?? "")}
              value={content}
              onChange={(v) => (mode === "paste" ? setCode(v ?? "") : mode === "diff" ? setDiff(v ?? "") : undefined)}
              options={{ minimap: { enabled: false }, fontSize: 13, readOnly: mode === "upload", scrollBeyondLastLine: false }} />
          </div>
        )}

        <fieldset className="space-y-1 text-sm">
          <legend className="font-medium">Analysis</legend>
          {(Object.keys(MODE_INFO) as AnalysisMode[]).map((m) => {
            const disabled = m !== "jev_only" && (!claudeOk || (m === "standard" && !caps?.jevConfigured));
            return (
              <label key={m} className={`flex items-start gap-2 ${disabled ? "opacity-50" : ""}`}>
                <input type="radio" name="analysis" className="mt-1" checked={analysis === m} disabled={disabled} onChange={() => { setAnalysis(m); setConfirmThorough(false); }} />
                <span><span className="font-medium">{MODE_INFO[m].label}</span><span className="block text-xs muted">{MODE_INFO[m].note}</span></span>
              </label>
            );
          })}
          {caps && !claudeOk && <p className="text-xs muted">Claude analysis is unavailable on this server ({(caps.claude as { reason: string }).reason.replace("_", " ")}); JEV-only mode is used.</p>}
          {analysis === "thorough" && (
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={confirmThorough} onChange={(e) => setConfirmThorough(e.target.checked)} />
              <span>I understand the full submitted code will be sent to Anthropic and this uses more tokens than a standard review.</span>
            </label>
          )}
          <p className="text-xs muted">
            Code is sent to JEV{analysis !== "jev_only" ? " and to Anthropic (Claude)" : ""} for processing, with best-effort masking of obvious secrets (it does not catch every secret). Do not submit code you are not allowed to share. Suggested code is never applied automatically.
          </p>
        </fieldset>

        <div className="flex items-center gap-3 text-sm">
          <span className={tooBig ? "text-red-500" : "muted"}>{bytes.toLocaleString()} / {MAX_INPUT_BYTES.toLocaleString()} bytes</span>
          {mode === "upload" && upload && <button className="underline muted" onClick={() => setUpload(null)}>Remove {upload.name}</button>}
          <div className="ml-auto flex gap-2">
            {loading && <button onClick={() => ctrl.current?.abort()} className="panel px-3 py-1.5">Cancel</button>}
            <button disabled={loading || !content.trim() || tooBig || (analysis === "thorough" && !confirmThorough)} onClick={submit}
              className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-1.5 text-white disabled:opacity-50">
              {loading && <Loader2 size={14} className="animate-spin" />} {loading ? "Reviewing…" : "Review"}
            </button>
          </div>
        </div>
        {error && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</p>}
      </section>

      {result && <ResultView result={result} />}
    </div>
  );
}
