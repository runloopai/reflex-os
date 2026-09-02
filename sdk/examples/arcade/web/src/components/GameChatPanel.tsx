/**
 * The game's chat room: everyone watching talks here, Twitch-style. The
 * game owner's messages carry a crown badge; hovering a player's name or
 * avatar shows their profile card (avatar, name, bio). A live viewer count
 * sits in the header. Messages arrive over the arcade hub socket (scoped
 * to the game's visibility server-side).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Crown, MessagesSquare } from 'lucide-react';
import { arcade, type ChatMessage } from '../lib/api.ts';
import { useArcadeFrames, useArcadeReconnect } from '../lib/socket.tsx';
import { useSession } from '../lib/session.ts';
import { PanelHeader } from './PanelHeader.tsx';
import { Popcard } from './Popcard.tsx';
import { ProfileCardContent } from './UserRef.tsx';
import { Avatar } from './Avatar.tsx';

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function GameChatPanel({ gameId, ownerId }: { gameId: string; ownerId: string }) {
  const { me } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    (onFailure: () => void) => {
      arcade
        .listGameChat(gameId)
        .then(({ messages }) => setMessages(messages))
        .catch(onFailure);
    },
    [gameId],
  );

  useEffect(() => load(() => setMessages([])), [load]);

  // Messages sent while the socket was down were never delivered and are
  // never replayed — re-read the room on reconnect, keeping what we have if
  // the refetch fails.
  useArcadeReconnect(() => load(() => {}));

  useArcadeFrames((frame) => {
    if (frame.type !== 'chat.message' || frame.message.gameId !== gameId) return;
    setMessages((old) =>
      old.some((m) => m.id === frame.message.id) ? old : [...old, frame.message],
    );
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { message } = await arcade.sendGameChat(gameId, body);
      setMessages((old) => (old.some((m) => m.id === message.id) ? old : [...old, message]));
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sending failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* The same header card the agent and suggestion panels wear: three
          tabs in one column only read as one surface if their tops match. */}
      <PanelHeader title="Room chat" icon={<MessagesSquare size={15} aria-hidden />}>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Everyone watching talks here. The owner wears a crown.
        </p>
      </PanelHeader>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/15 text-violet-300"
            >
              <MessagesSquare size={18} />
            </span>
            <p className="text-sm font-medium text-zinc-300">Nothing here yet. Say hi!</p>
          </div>
        ) : (
          messages.map((message) => {
            const isOwner = message.authorId === ownerId;
            const isMe = message.authorId === me.id;
            return (
              <div key={message.id} className="text-sm">
                <Popcard
                  content={
                    <ProfileCardContent
                      userId={message.authorId}
                      fallbackName={message.authorName}
                      isOwner={isOwner}
                    />
                  }
                >
                  <span className="inline-flex cursor-pointer items-center gap-1.5">
                    <Avatar
                      userId={message.authorId}
                      name={message.authorName}
                      avatar={message.authorAvatar}
                      size={18}
                    />
                    {isOwner ? (
                      <span
                        aria-label="Game owner"
                        title="Game owner"
                        className="inline-flex h-4 w-4 items-center justify-center rounded bg-amber-400/20 text-amber-300"
                      >
                        <Crown size={11} strokeWidth={2.5} aria-hidden />
                      </span>
                    ) : null}
                    <span
                      className={`font-semibold hover:underline ${
                        isOwner ? 'text-amber-300' : isMe ? 'text-violet-300' : 'text-zinc-200'
                      }`}
                    >
                      {message.authorName}
                    </span>
                  </span>
                </Popcard>
                <span className="ml-2 text-xs text-zinc-500">{timeOf(message.createdAt)}</span>
                <p className="mt-0.5 min-w-0 [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-zinc-300">
                  {message.body}
                </p>
              </div>
            );
          })
        )}
      </div>
      <form
        className="p-1 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {error ? <p className="mb-2 text-xs text-rose-400">{error}</p> : null}
        <div className="flex items-center gap-2 rounded-2xl border border-transparent bg-zinc-900/80 p-2 shadow-xl shadow-black/50 backdrop-blur-xl focus-within:border-violet-500">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message the room"
            maxLength={500}
            // text-base on phones: iOS Safari zooms the page when a focused
            // input is under 16px, which strands the composer off-screen.
            className="min-w-0 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-zinc-500 pointer-coarse:py-1 pointer-coarse:text-base"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="shrink-0 rounded-xl bg-violet-600 px-3.5 py-1.5 text-sm font-semibold transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-10"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
