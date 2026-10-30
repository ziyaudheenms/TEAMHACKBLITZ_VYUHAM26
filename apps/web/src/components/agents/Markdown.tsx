import React from "react";

/**
 * Small, dependency-free markdown renderer for chat answers.
 *
 * Security: output is built exclusively from React elements (no dangerouslySetInnerHTML),
 * and links are restricted to http(s) URLs. Agent output can contain text scraped from
 * untrusted web pages, so nothing here may ever inject raw HTML.
 */

const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))|(https?:\/\/[^\s<>)\]]+)/g;

const LINK_CLASS = "text-[#1F541D] underline decoration-[#74D96F] underline-offset-2 hover:decoration-2 break-words";

function renderInline(text: string, prefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${prefix}-${n++}`;
    let consumed = m[0];
    if (m[1]) {
      out.push(
        <code key={key} className="rounded-md bg-[#EDEDED] px-1.5 py-0.5 text-[0.85em] font-mono text-[#262626]">
          {m[1].slice(1, -1)}
        </code>
      );
    } else if (m[2]) {
      out.push(<strong key={key}>{m[2].slice(2, -2)}</strong>);
    } else if (m[3]) {
      out.push(<em key={key}>{m[3].slice(1, -1)}</em>);
    } else if (m[4]) {
      const parts = /^\[([^\]]+)\]\((.+)\)$/.exec(m[4]);
      out.push(
        <a key={key} href={parts![2]} target="_blank" rel="noopener noreferrer nofollow" className={LINK_CLASS}>
          {parts![1]}
        </a>
      );
    } else if (m[5]) {
      // Keep sentence punctuation out of the link.
      const url = m[5].replace(/[.,;:!?]+$/, "");
      consumed = url;
      out.push(
        <a key={key} href={url} target="_blank" rel="noopener noreferrer nofollow" className={LINK_CLASS}>
          {url}
        </a>
      );
    }
    last = m.index + consumed.length;
    INLINE_RE.lastIndex = last;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isFence = (l: string) => /^\s*```/.test(l);
const isHeading = (l: string) => /^#{1,4}\s+/.test(l);
const isBullet = (l: string) => /^\s*[-*•]\s+/.test(l);
const isOrdered = (l: string) => /^\s*\d+[.)]\s+/.test(l);
const isQuote = (l: string) => /^\s*>\s?/.test(l);
const isRule = (l: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
const splitRow = (l: string) =>
  l
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const startsBlock = (l: string, next?: string) =>
  isFence(l) ||
  isHeading(l) ||
  isBullet(l) ||
  isOrdered(l) ||
  isQuote(l) ||
  isRule(l) ||
  (l.includes("|") && next !== undefined && isTableSep(next));

const HEADING_CLASS: Record<number, string> = {
  1: "text-lg font-extrabold mt-5 mb-2",
  2: "text-base font-extrabold mt-5 mb-2",
  3: "text-sm font-bold mt-4 mb-1.5",
  4: "text-sm font-bold mt-3 mb-1",
};

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isFence(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) buf.push(lines[i++]);
      i++; // closing fence (or end of a still-streaming block)
      blocks.push(
        <pre
          key={k++}
          className="my-3 overflow-x-auto rounded-2xl bg-[#1F1F1F] p-4 text-xs leading-relaxed text-[#EDEDED] font-mono"
        >
          <code>{buf.join("\n")}</code>
        </pre>
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      blocks.push(
        React.createElement(
          `h${Math.min(level + 1, 6)}`,
          { key: k++, className: HEADING_CLASS[level] },
          renderInline(h[2], `h${k}`)
        )
      );
      i++;
      continue;
    }

    if (isRule(line)) {
      blocks.push(<hr key={k++} className="my-4 border-[#EDEDED]" />);
      i++;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      blocks.push(
        <div key={k++} className="my-3 overflow-x-auto rounded-2xl border border-[#EDEDED]">
          <table className="w-full text-xs">
            <thead className="bg-[#F8F9FA]">
              <tr>
                {head.map((c, ci) => (
                  <th key={ci} className="px-3 py-2 text-left font-bold text-[#262626]">
                    {renderInline(c, `th${k}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t border-[#EDEDED]">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3 py-2 align-top">
                      {renderInline(c, `td${k}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (isBullet(line) || isOrdered(line)) {
      const ordered = isOrdered(line);
      const test = ordered ? isOrdered : isBullet;
      const strip = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/;
      const items: string[] = [];
      while (i < lines.length && test(lines[i])) items.push(lines[i++].replace(strip, ""));
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={k++} className={`my-2 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-[#56BE51]`}>
          {items.map((it, ii) => (
            <li key={ii} className="pl-1">
              {renderInline(it, `li${k}-${ii}`)}
            </li>
          ))}
        </Tag>
      );
      continue;
    }

    if (isQuote(line)) {
      const buf: string[] = [];
      while (i < lines.length && isQuote(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(
        <blockquote key={k++} className="my-3 border-l-4 border-[#74D96F] bg-[#F8F9FA] py-1.5 pl-4 pr-2 text-[#444]">
          {renderInline(buf.join(" "), `bq${k}`)}
        </blockquote>
      );
      continue;
    }

    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++]);
    blocks.push(
      <p key={k++} className="my-2 leading-relaxed">
        {para.flatMap((p, pi) => [
          ...(pi ? [<br key={`br${pi}`} />] : []),
          ...renderInline(p, `p${k}-${pi}`),
        ])}
      </p>
    );
  }

  return <div className="break-words">{blocks}</div>;
}
