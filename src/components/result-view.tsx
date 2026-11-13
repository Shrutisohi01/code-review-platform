"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Copy, EyeOff } from "lucide-react";
import type { Finding, ReviewResult, Severity } from "@/lib/review/types";
import { AnalysisNotice, FindingDetails, OriginBadge } from "./finding-details";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "informational"];
const SEV_STYLE: Record<Severity, string> = {
  critical: "bg-red-600 text-white", high: "bg-orange-500 text-white", medium: "bg-amber-400 text-black",
  low: "bg-sky-500 text-white", informational: "bg-zinc-400 text-black",
};
type State = "open" | "resolved" | "ignored";

export function ResultView({ result }: { result: ReviewResult }) {
  const [sev, setSev] = useState<Severity | "all">("all");
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, State>>({});
  const [fileIdx, setFileIdx] = useState(0);
  const editor = useRef<any>(null);
  const monaco = useRef<any>(null);
  const decos = useRef<any>(null);

  const file = result.files[fileIdx] ?? result.files[0];
  const text = useMemo(() => {
    if (!file) return "";
    const nums = Object.keys(file.lines).map(Number);
    const max = Math.max(...nums, 0);
    return Array.from({ length: max }, (_, i) => file.lines[String(i + 1)] ?? "").join("\n");
  }, [file]);

  const shown = result.findings.filter(
    (f) => (sev === "all" || f.severity === sev) && (cat === "all" || f.category === cat) &&
      (!q || `${f.title} ${f.description} ${f.file_path}`.toLowerCase().includes(q.toLowerCase())),
  );
  const counts = Object.fromEntries(SEV_ORDER.map((s) => [s, result.findings.filter((f) => f.severity === s).length]));

  function mark(f: Finding | null) {
    if (!editor.current || !monaco.current || !file) return;
    const here = result.findings.filter((x) => x.file_path === file.path);
    const d = here.map((x) => ({
      range: new monaco.current.Range(x.start_line, 1, x.end_line, 1),
      options: { isWholeLine: true, className: f && x.id === f.id ? "line-active" : "line-flag" },
    }));
    decos.current?.clear();
    decos.current = editor.current.createDecorationsCollection(d);
  }

  function goTo(f: Finding) {
    setOpen(f.id);
    const idx = result.files.findIndex((x) => x.path === f.file_path);
    if (idx >= 0 && idx !== fileIdx) setFileIdx(idx);
    setTimeout(() => {
      mark(f);
      editor.current?.revealLineInCenter(f.start_line);
    }, 50);
  }

  const banner = result.overall_assessment === null
    ? { cls: "border-amber-500/50 bg-amber-500/10", label: result.provider === "mock" ? "Unverified (mock provider)" : "Incomplete review" }
    : result.overall_assessment === "pass"
      ? { cls: "border-[var(--line)]", label: result.dismissed.length ? "No substantiated issues (candidates dismissed)" : "No regions flagged" }
      : result.overall_assessment === "concerns"
        ? { cls: "border-amber-500/50 bg-amber-500/10", label: "Concerns" }
        : { cls: "border-red-500/50 bg-red-500/10", label: "Needs attention" };

  return (
    <section className="space-y-4" aria-label="Review results">
      <div className={`panel border p-4 ${banner.cls}`}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">{banner.label}</h2>
          <span className="muted text-sm">{result.findings.length} finding(s) · {result.provider === "jev" ? `JEV model ${result.model}` : "mock"}</span>
          <div className="ml-auto flex gap-1.5 text-xs">
            {SEV_ORDER.map((s) => counts[s]! > 0 && <span key={s} className={`rounded px-2 py-0.5 ${SEV_STYLE[s]}`}>{counts[s]} {s}</span>)}
          </div>
        </div>
        <p className="mt-2 text-sm">{result.summary}</p>
        {result.limitations.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm muted">{result.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        )}
        <AnalysisNotice result={result} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel overflow-hidden">
          {result.files.length > 1 && (
            <select aria-label="File" className="m-2 panel px-2 py-1 text-sm" value={fileIdx} onChange={(e) => setFileIdx(Number(e.target.value))}>
              {result.files.map((f, i) => <option key={f.path} value={i}>{f.path}</option>)}
            </select>
          )}
          <Monaco height="520px" value={text} path={file?.path} theme={typeof window !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "vs-dark" : "light"}
            options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
            onMount={(ed, m) => { editor.current = ed; monaco.current = m; mark(null); }} />
        </div>

        <div className="panel flex max-h-[560px] flex-col">
          <div className="flex flex-wrap gap-2 border-b border-[var(--line)] p-2 text-sm">
            <input aria-label="Search findings" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="panel flex-1 px-2 py-1" />
            <select aria-label="Severity" value={sev} onChange={(e) => setSev(e.target.value as Severity | "all")} className="panel px-2 py-1">
              <option value="all">All severities</option>{SEV_ORDER.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} className="panel px-2 py-1">
              <option value="all">All categories</option>{["bug", "security", "performance", "maintainability"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <ul className="overflow-auto">
            {shown.length === 0 && <li className="p-6 text-center text-sm muted">{result.findings.length ? "No findings match the filters." : "Nothing was flagged."}</li>}
            {shown.map((f) => {
              const st = state[f.id] ?? "open";
              return (
                <li key={f.id} className={`border-b border-[var(--line)] p-3 ${st !== "open" ? "opacity-50" : ""}`}>
                  <button className="flex w-full items-start gap-2 text-left" aria-expanded={open === f.id} onClick={() => (open === f.id ? setOpen(null) : goTo(f))}>
                    <span className={`mt-0.5 rounded px-1.5 py-0.5 text-xs ${SEV_STYLE[f.severity]}`}>{f.severity}</span>
                    <span className="flex-1 text-sm font-medium">{f.title}<span className="block text-xs font-normal muted">{f.file_path}:{f.start_line}{f.end_line > f.start_line ? `–${f.end_line}` : ""} · {f.category} · <OriginBadge finding={f} /></span></span>
                    <ChevronDown size={16} className={open === f.id ? "rotate-180" : ""} />
                  </button>
                  {open === f.id && (
                    <div className="mt-2 space-y-2 pl-1 text-sm">
                      <FindingDetails finding={f} />
                      <div className="flex gap-2 text-xs">
                        <button className="panel inline-flex items-center gap-1 px-2 py-1" onClick={() => navigator.clipboard.writeText(`${f.title}\n${f.file_path}:${f.start_line}-${f.end_line}\n${f.description}`)}><Copy size={12} /> Copy summary</button>
                        <button className="panel inline-flex items-center gap-1 px-2 py-1" onClick={() => setState({ ...state, [f.id]: st === "resolved" ? "open" : "resolved" })}><Check size={12} /> {st === "resolved" ? "Reopen" : "Resolve"}</button>
                        <button className="panel inline-flex items-center gap-1 px-2 py-1" onClick={() => setState({ ...state, [f.id]: st === "ignored" ? "open" : "ignored" })}><EyeOff size={12} /> {st === "ignored" ? "Unignore" : "Ignore"}</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {result.dismissed.length > 0 && (
        <details className="panel p-3 text-sm">
          <summary className="cursor-pointer font-medium">JEV candidates Claude could not substantiate ({result.dismissed.length})</summary>
          <p className="mt-1 text-xs muted">These are not confirmed defects and not confirmed clean: Claude judged only from the code excerpt it was given.</p>
          <ul className="mt-2 space-y-2">
            {result.dismissed.map((f) => (
              <li key={f.id} className="border-t border-[var(--line)] pt-2">
                <div className="font-medium">{f.file_path}:{f.start_line}–{f.end_line} · JEV said {f.severity} {f.category}</div>
                <p className="muted">{f.evidence ?? "No reason given."}</p>
                {f.uncertainty && <p className="text-xs muted">Uncertainty: {f.uncertainty}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {result.disagreements.length > 0 && (
        <details className="panel p-3 text-sm">
          <summary className="cursor-pointer font-medium">Provider disagreements ({result.disagreements.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 muted">{result.disagreements.map((d, i) => <li key={`${d.finding_id}-${i}`}>{d.message}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
