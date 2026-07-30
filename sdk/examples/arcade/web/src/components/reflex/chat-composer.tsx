/**
 * Message composer: one rounded bar with an auto-growing textarea and an
 * icon cluster — optional attachment picker, optional voice dictation, an
 * interrupt button while the agent is working, and a round send button.
 *
 * Enter sends, Shift+Enter inserts a newline, and the control disables
 * itself while a send is in flight. Attachments arrive via the paperclip,
 * drag & drop onto the bar, or pasting from the clipboard; they are handed
 * to `onSend` as base64 payloads (see `ChatAttachment`) and `useSendMessage`
 * turns them into `image`/`file` content blocks. Voice uses the browser's
 * SpeechRecognition when available (the button hides itself otherwise) and
 * types into the draft. Pass `onInterrupt` while a turn is running to show
 * the stop button. Colors come from `--reflex-chat-*` CSS variables.
 *
 * You own this file; swap in your design system's inputs freely.
 */
import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent, KeyboardEvent } from 'react';

/**
 * One picked attachment, base64-encoded (no `data:` prefix). Structurally
 * identical to `ChatAttachment` in `use-send-message` — duplicated (not
 * imported) so this component installs standalone.
 */
export interface ComposerAttachment {
  name: string;
  mimeType: string;
  data: string;
}

export interface ChatComposerProps {
  onSend: (message: string, attachments: ComposerAttachment[]) => void;
  /** True while a send is in flight; disables input and button. */
  sending?: boolean;
  placeholder?: string;
  /** Show the paperclip and accept dropped/pasted files as content blocks. */
  enableAttachments?: boolean;
  /** Show the microphone and dictate into the draft (SpeechRecognition). */
  enableVoice?: boolean;
  /** When set, a stop button appears (pass it while the agent is running). */
  onInterrupt?: () => void;
  /** True while an interrupt request is in flight. */
  interrupting?: boolean;
}

/** Minimal structural type for the (still prefixed) SpeechRecognition API. */
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    (new () => SpeechRecognitionLike) | null;
}

async function toAttachment(file: File): Promise<ComposerAttachment> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return { name: file.name, mimeType: file.type || 'application/octet-stream', data };
}

const iconButton =
  'flex h-8 w-8 items-center justify-center rounded-full text-[var(--reflex-chat-muted-fg,#6b7280)] transition hover:bg-white/10 hover:text-[var(--reflex-chat-fg,#111827)] disabled:opacity-40';

export function ChatComposer({
  onSend,
  sending = false,
  placeholder = 'Send a message…',
  enableAttachments = false,
  enableVoice = false,
  onInterrupt,
  interrupting = false,
}: ChatComposerProps) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [listening, setListening] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceSupported = enableVoice && speechRecognitionCtor() !== null;

  // Auto-grow the textarea with its content (capped via max-h).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  const submit = () => {
    const message = draft.trim();
    if ((!message && attachments.length === 0) || sending) return;
    recognitionRef.current?.stop();
    onSend(message, attachments);
    setDraft('');
    setAttachments([]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const converted = await Promise.all(Array.from(files, toAttachment));
    setAttachments((old) => [...old, ...converted]);
  };

  // Drag & drop and paste are alternative attachment inputs; both funnel
  // through the same conversion as the paperclip.
  const onDragOver = (event: DragEvent) => {
    if (!enableAttachments) return;
    if (Array.from(event.dataTransfer.types).includes('Files')) {
      event.preventDefault();
      setDragging(true);
    }
  };

  const onDrop = (event: DragEvent) => {
    if (!enableAttachments) return;
    event.preventDefault();
    setDragging(false);
    void pickFiles(event.dataTransfer.files);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!enableAttachments || event.clipboardData.files.length === 0) return;
    event.preventDefault();
    void pickFiles(event.clipboardData.files);
  };

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event) => {
      const chunk = Array.from(event.results, (result) => result[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (chunk) setDraft((old) => (old ? `${old.trimEnd()} ${chunk}` : chunk));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  return (
    <form
      className="p-1 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div
        className={`rounded-2xl border bg-[var(--reflex-chat-input-bg,#ffffff)] px-3 py-2 shadow-xl shadow-black/50 backdrop-blur-xl focus-within:border-[var(--reflex-chat-accent,#4f46e5)] ${
          dragging
            ? 'border-dashed border-[var(--reflex-chat-accent,#4f46e5)]'
            : 'border-transparent'
        }`}
      >
        {attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((attachment, index) => (
              <span
                key={`${attachment.name}-${index}`}
                className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-xs text-[var(--reflex-chat-fg,#111827)]"
              >
                {attachment.mimeType.startsWith('image/') ? '🖼' : '📄'} {attachment.name}
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  className="ml-0.5 opacity-60 hover:opacity-100"
                  onClick={() => setAttachments((old) => old.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          className="max-h-40 w-full resize-none bg-transparent text-sm text-[var(--reflex-chat-input-fg,#111827)] outline-none placeholder:text-[var(--reflex-chat-muted-fg,#6b7280)]"
          rows={1}
          value={draft}
          placeholder={dragging ? 'Drop files to attach' : listening ? 'Listening…' : placeholder}
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />

        <div className="mt-1 flex items-center justify-end gap-1">
          {enableAttachments ? (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  void pickFiles(event.target.files);
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                title="Attach files"
                aria-label="Attach files"
                className={iconButton}
                disabled={sending}
                onClick={() => fileRef.current?.click()}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M21 12.5l-8.5 8.5a6 6 0 01-8.5-8.5L12.5 4a4 4 0 015.7 5.7L9.7 18.2a2 2 0 01-2.9-2.9l7.8-7.8"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </>
          ) : null}
          {voiceSupported ? (
            <button
              type="button"
              title={listening ? 'Stop dictation' : 'Dictate'}
              aria-label={listening ? 'Stop dictation' : 'Dictate'}
              className={`${iconButton} ${listening ? 'animate-pulse !text-rose-400' : ''}`}
              disabled={sending}
              onClick={toggleVoice}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect
                  x="9"
                  y="3"
                  width="6"
                  height="11"
                  rx="3"
                  stroke="currentColor"
                  strokeWidth="1.7"
                />
                <path
                  d="M5 11a7 7 0 0014 0M12 18v3"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : null}
          {onInterrupt ? (
            <button
              type="button"
              title="Stop the current turn"
              aria-label="Stop the current turn"
              className={`${iconButton} !text-rose-400 hover:!bg-rose-400/10 ${interrupting ? 'animate-pulse' : ''}`}
              disabled={interrupting}
              onClick={onInterrupt}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
                <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
              </svg>
            </button>
          ) : null}
          <button
            type="submit"
            title="Send"
            aria-label="Send"
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--reflex-chat-accent,#4f46e5)] text-[var(--reflex-chat-accent-fg,#ffffff)] transition hover:brightness-110 disabled:opacity-40"
            disabled={sending || (draft.trim().length === 0 && attachments.length === 0)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 20V5m0 0l-6 6m6-6l6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </form>
  );
}
