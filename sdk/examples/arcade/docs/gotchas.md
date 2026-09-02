# Gotchas worth knowing

Collected traps for the arcade demo. Map: [`../AGENTS.md`](../AGENTS.md).

- `StatCounter` needs `key={target}` or it won't re-animate when data loads.
- A component with an entrance animation breaks `toBeVisible()` in a play
  function: jest-dom reads the frame-zero `opacity: 0` as hidden. Wait for it
  (`waitFor`) once when it opens rather than dropping the animation.
- The sticky nav must stay near-opaque (`bg-zinc-950/95 backdrop-blur-xl`);
  translucent bars ghost scrolled content through them.
- Entity ids come from `newId('<kind>')` in `server/ids.ts` (crypto-backed);
  don't reach for `Math.random`/`crypto.randomUUID`.
- Real agent streams speak three dialects (flat, ACP, native Claude Code);
  parsing lives in the scaffolded kit's `event-utils` — fix dialect bugs
  upstream in the chat-kit registry.
- Game art is a file contract, not an API: agents serve
  `/arcade/{icon,preview}.{svg,png}` and `/arcade/preview-anim.svg` (looping
  animated SVG for tile hover; the engine also accepts `preview.gif`/`.webp`
  as fallbacks agents are not prompted for) from their dev daemon and the
  watcher captures changes into the database after each turn (`setGameArt`,
  art endpoints in `routes.ts`). Keep the system prompt, engine `ART_KINDS`,
  and the mock's `/play/:id/arcade/:file` route in sync.
- A system prompt is frozen when the agent launches, so a rule added to
  `GAME_AGENT_SYSTEM_PROMPT` reaches only games created after it. Games
  already running catch up through `GAME_BRIEF_VERSION` + `briefUpdatePrompt`:
  bump the version, put the new rules in that prompt, and the next dispatched
  turn carries them once (recorded on the send — there is nothing to
  re-probe, unlike the art appendix, which repeats while art is missing).
