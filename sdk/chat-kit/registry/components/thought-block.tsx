/**
 * One thinking section, collapsed behind a "Thought for a moment"
 * disclosure — thoughts are long and arrive in bulk, so the transcript
 * stays readable and the curious can expand.
 *
 * `message-list` composes this; import it directly to render reasoning in
 * your own layouts. Colors come from `--reflex-chat-*` CSS variables. You
 * own this file.
 */
export interface ThoughtBlockProps {
  children: string;
  /** Disclosure label. */
  label?: string;
  defaultOpen?: boolean;
}

export function ThoughtBlock({
  children,
  label = 'Thought for a moment',
  defaultOpen = false,
}: ThoughtBlockProps) {
  return (
    <details className="group mx-1" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-[var(--reflex-chat-muted-fg,#6b7280)] select-none hover:text-[var(--reflex-chat-fg,#111827)]">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
          ▸
        </span>
        <span className="italic">{label}</span>
      </summary>
      <div className="mt-1 border-l-2 border-[var(--reflex-chat-border,#e5e7eb)] py-0.5 pl-2.5 text-xs whitespace-pre-wrap italic opacity-70 text-[var(--reflex-chat-muted-fg,#6b7280)] break-words [overflow-wrap:anywhere]">
        {children}
      </div>
    </details>
  );
}
