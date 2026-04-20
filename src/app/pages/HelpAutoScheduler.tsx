import React, { useMemo } from "react";
import { PageLayout } from "../components/PageLayout";
// Vite ?raw import — the markdown file is the single source of truth.
// To update this Help page, edit src/app/pages/help/auto-scheduler.md.
import rawMd from "./help/auto-scheduler.md?raw";

// Minimal Markdown renderer — supports headings, lists, tables,
// blockquotes, horizontal rules, bold, italic, inline code, and paragraphs.
// Intentionally scoped to what auto-scheduler.md uses; extend if new syntax
// is added to the source file.

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "hr" }
  | { kind: "blockquote"; text: string };

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") { i++; continue; }

    if (/^---+\s*$/.test(line)) { blocks.push({ kind: "hr" }); i++; continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ kind: "h", level: h[1].length, text: h[2] }); i++; continue; }

    if (line.startsWith(">")) {
      const lines2: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        lines2.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "blockquote", text: lines2.join(" ") });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    if (line.startsWith("|") && i + 1 < lines.length && /^\|[-:\s|]+\|$/.test(lines[i + 1])) {
      const header = line.slice(1, -1).split("|").map((s) => s.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|") && lines[i].trim() !== "") {
        const cells = lines[i].slice(1, -1).split("|").map((s) => s.trim());
        rows.push(cells);
        i++;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|-{3,}\s*$|>|\|)/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "p", text: para.join(" ") });
  }

  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  const patterns: Array<[RegExp, (m: RegExpExecArray) => React.ReactNode]> = [
    [/\*\*([^*]+)\*\*/, (m) => <strong key={key++} className="font-semibold">{m[1]}</strong>],
    [/\*([^*]+)\*/, (m) => <em key={key++} className="italic">{m[1]}</em>],
    [/`([^`]+)`/, (m) => <code key={key++} className="px-1 py-0.5 rounded bg-muted text-[0.85em] font-mono">{m[1]}</code>],
  ];

  while (remaining.length > 0) {
    let earliestIdx = -1;
    let chosen: { m: RegExpExecArray; render: (m: RegExpExecArray) => React.ReactNode } | null = null;
    for (const [re, render] of patterns) {
      const m = re.exec(remaining);
      if (m && (earliestIdx === -1 || m.index < earliestIdx)) {
        earliestIdx = m.index;
        chosen = { m, render };
      }
    }
    if (!chosen) { nodes.push(remaining); break; }
    if (chosen.m.index > 0) nodes.push(remaining.slice(0, chosen.m.index));
    nodes.push(chosen.render(chosen.m));
    remaining = remaining.slice(chosen.m.index + chosen.m[0].length);
  }

  return nodes;
}

function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseBlocks(source), [source]);

  return (
    <div className="prose prose-slate max-w-none text-sm leading-relaxed text-foreground">
      {blocks.map((b, idx) => {
        switch (b.kind) {
          case "h": {
            const size =
              b.level === 1 ? "text-3xl font-black mt-0 mb-4 pb-2 border-b" :
              b.level === 2 ? "text-2xl font-bold mt-8 mb-3" :
              b.level === 3 ? "text-lg font-semibold mt-6 mb-2" :
              "text-base font-semibold mt-4 mb-2";
            return <div key={idx} className={size}>{renderInline(b.text)}</div>;
          }
          case "p":
            return <p key={idx} className="my-3">{renderInline(b.text)}</p>;
          case "ul":
            return (
              <ul key={idx} className="list-disc pl-6 my-3 space-y-1">
                {b.items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}
              </ul>
            );
          case "ol":
            return (
              <ol key={idx} className="list-decimal pl-6 my-3 space-y-1">
                {b.items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}
              </ol>
            );
          case "blockquote":
            return (
              <blockquote key={idx} className="my-3 border-l-4 border-amber-300 bg-amber-50/50 pl-4 py-2 text-amber-900 italic">
                {renderInline(b.text)}
              </blockquote>
            );
          case "hr":
            return <hr key={idx} className="my-6 border-slate-200" />;
          case "table":
            return (
              <div key={idx} className="overflow-x-auto my-4">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      {b.header.map((h, i) => (
                        <th key={i} className="border border-slate-200 px-3 py-2 text-left font-semibold">
                          {renderInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, ri) => (
                      <tr key={ri} className="hover:bg-slate-50">
                        {row.map((cell, ci) => (
                          <td key={ci} className="border border-slate-200 px-3 py-2 align-top">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}

export function HelpAutoScheduler() {
  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto py-8 px-6">
        <Markdown source={rawMd} />
      </div>
    </PageLayout>
  );
}

export default HelpAutoScheduler;
