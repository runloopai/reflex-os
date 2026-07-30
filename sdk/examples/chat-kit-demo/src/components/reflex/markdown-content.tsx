/**
 * Standalone markdown renderer for chat content: GFM with utility-styled
 * elements — inline code as chips, fenced blocks, lists, tables — with no
 * typography plugin required. `message-bubble` composes it for agent
 * messages; import it directly to render markdown anywhere else (result
 * summaries, PR descriptions, ...).
 *
 * Colors come from `--reflex-chat-*` CSS variables. You own this file.
 */
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface MarkdownContentProps {
  children: string;
  className?: string;
  /** Merge or replace individual element renderers. */
  components?: Components;
}

/**
 * Utility-styled markdown elements. Inline code renders as a chip; the
 * `pre` wrapper resets the chip inside fenced blocks via arbitrary
 * variants, so blocks stay flat.
 */
export const markdownComponents: Components = {
  p: (props) => <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0" {...props} />,
  ul: (props) => <ul className="my-1.5 list-disc space-y-1 pl-5" {...props} />,
  ol: (props) => <ol className="my-1.5 list-decimal space-y-1 pl-5" {...props} />,
  h1: (props) => <h1 className="mt-3 mb-1.5 text-base font-semibold first:mt-0" {...props} />,
  h2: (props) => <h2 className="mt-3 mb-1.5 text-base font-semibold first:mt-0" {...props} />,
  h3: (props) => <h3 className="mt-3 mb-1 text-sm font-semibold first:mt-0" {...props} />,
  h4: (props) => <h4 className="mt-2 mb-1 text-sm font-semibold first:mt-0" {...props} />,
  a: (props) => (
    <a
      className="break-all text-[var(--reflex-chat-accent,#4f46e5)] underline underline-offset-2"
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  code: (props) => (
    <code
      className="rounded-md bg-[var(--reflex-chat-code-bg,rgba(127,127,127,0.18))] px-1.5 py-0.5 font-mono text-[0.85em] break-all"
      {...props}
    />
  ),
  pre: (props) => (
    <pre
      className="my-2 max-w-full overflow-x-auto rounded-lg border border-[var(--reflex-chat-border,#e5e7eb)] bg-[var(--reflex-chat-code-bg,rgba(127,127,127,0.12))] p-3 text-xs [&_code]:rounded-none [&_code]:bg-transparent [&_code]:p-0"
      {...props}
    />
  ),
  blockquote: (props) => (
    <blockquote
      className="my-2 border-l-2 border-[var(--reflex-chat-border,#e5e7eb)] pl-3 italic opacity-80"
      {...props}
    />
  ),
  hr: () => <hr className="my-3 border-[var(--reflex-chat-border,#e5e7eb)]" />,
  // Wide tables scroll inside the bubble instead of stretching the pane.
  table: (props) => (
    <div className="my-2 max-w-full overflow-x-auto">
      <table className="min-w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: (props) => (
    <th
      className="border border-[var(--reflex-chat-border,#e5e7eb)] px-2 py-1 text-left font-semibold"
      {...props}
    />
  ),
  td: (props) => (
    <td className="border border-[var(--reflex-chat-border,#e5e7eb)] px-2 py-1" {...props} />
  ),
};

export function MarkdownContent({ children, className, components }: MarkdownContentProps) {
  return (
    <div className={className ?? 'min-w-0 text-sm break-words [overflow-wrap:anywhere]'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components ? { ...markdownComponents, ...components } : markdownComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
