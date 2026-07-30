/**
 * How the arcade is built: Reflex agents on Runloop devboxes, driven
 * through the public SDK, all open source. Static page — the copy is the
 * content, the stack is the story.
 */
import { EyebrowPill, GlassCard, GradientText, Sparkle, TokenStream } from 'performative-ui';
import { Blocks, Bot, Cloud, Heart, Joystick, MonitorPlay, Radio, Wrench } from 'lucide-react';

const STEPS: Array<{ icon: typeof Bot; title: string; body: string }> = [
  {
    icon: Bot,
    title: 'An agent takes the brief',
    body: 'Starting a game sends your idea to Reflex, which boots a real coding agent (Claude Code or opencode) with your saved API key.',
  },
  {
    icon: Cloud,
    title: 'It gets its own devbox',
    body: 'The agent works inside an isolated Runloop devbox — a real machine with a shell, an editor, and a network, not a sandbox pretending to be one.',
  },
  {
    icon: Wrench,
    title: 'It builds with Vite',
    body: 'The agent scaffolds a TypeScript + Vite project and keeps a dev server running, then registers it as a daemon so the devbox tunnels it out.',
  },
  {
    icon: MonitorPlay,
    title: 'The stage goes live',
    body: 'That daemon URL becomes the iframe you play in. Every save the agent makes is on your screen a hot-reload later.',
  },
  {
    icon: Radio,
    title: 'Everything streams',
    body: 'The agent chat is the real event stream — thoughts, tool calls, and edits arrive over WebSockets, rendered by the same components Reflex uses.',
  },
  {
    icon: Heart,
    title: 'The room steers',
    body: 'Viewers suggest bug fixes, improvements, and features, then heart their favorites. When the agent goes idle, the most-hearted suggestion is its next brief.',
  },
];

const STACK: Array<{
  icon: typeof Bot;
  title: string;
  body: string;
  href: string;
  link: string;
}> = [
  {
    icon: Bot,
    title: 'Reflex',
    body: 'The agent platform. It runs the coding agents, streams every step they take, and exposes it all through a typed public API.',
    href: 'https://reflex.runloop.ai',
    link: 'reflex.runloop.ai',
  },
  {
    icon: Cloud,
    title: 'Runloop',
    body: 'The infrastructure. Each agent gets a devbox with real compute, and daemon tunnels turn a dev server inside it into a URL anyone can load.',
    href: 'https://runloop.ai',
    link: 'runloop.ai',
  },
  {
    icon: Blocks,
    title: 'The Reflex SDK',
    body: 'This app is an SDK consumer. @runloop/reflex-client is the typed client and socket; @runloop/reflex-chat-kit generated the agent chat pane, shadcn-style, into this codebase.',
    href: 'https://github.com/runloopai/reflex',
    link: 'github.com/runloopai/reflex',
  },
  {
    icon: Joystick,
    title: 'The arcade itself',
    body: 'A Fastify + PGLite server that keeps owner keys server-side behind a per-game proxy, and a React 19 + Vite + Tailwind 4 front end dressed in performative-ui.',
    href: 'https://github.com/runloopai/reflex',
    link: 'sdk/examples/arcade',
  },
];

export function About() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
      <EyebrowPill statusColor="#a78bfa">Under the hood</EyebrowPill>
      <h1 className="mt-4 max-w-2xl text-4xl leading-tight font-extrabold tracking-tight">
        Built by agents, <GradientText>on agents</GradientText>
      </h1>
      <p className="mt-4 max-w-2xl text-zinc-400">
        Reflex Arcade is a demo of what the Reflex platform looks like from the outside: every
        stream you watch here is a real coding agent on real infrastructure, reached only through
        the public SDK. No private APIs, no staged footage. And yes — the arcade was itself built by
        a Reflex agent.
      </p>

      <section className="mt-12">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-widest text-zinc-400 uppercase">
          <Sparkle /> How a game goes live
        </h2>
        <ol className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className="relative rounded-2xl border border-white/10 bg-zinc-900/50 p-5 backdrop-blur-sm"
              >
                <span className="absolute top-4 right-4 text-2xl font-black text-white/10 select-none">
                  {i + 1}
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/25 text-violet-300">
                  <Icon size={17} aria-hidden />
                </span>
                <h3 className="mt-3 font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm text-zinc-400">{step.body}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="mt-12">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-widest text-zinc-400 uppercase">
          <Sparkle /> The stack
        </h2>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {STACK.map((item) => {
            const Icon = item.icon;
            return (
              <GlassCard key={item.title} glowOnHover>
                <GlassCard.Icon>
                  <Icon size={18} aria-hidden />
                </GlassCard.Icon>
                <GlassCard.Title>{item.title}</GlassCard.Title>
                <GlassCard.Body>{item.body}</GlassCard.Body>
                <GlassCard.Link href={item.href} target="_blank" rel="noreferrer">
                  {item.link}
                </GlassCard.Link>
              </GlassCard>
            );
          })}
        </div>
      </section>

      <section className="mt-12 rounded-3xl border border-white/10 bg-zinc-900/50 p-8 backdrop-blur-sm">
        <h2 className="text-lg font-bold">All of it is open source</h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          The arcade lives in the Reflex repository under <code>sdk/examples/arcade</code>, next to
          the SDK packages it consumes — the typed client, the chat kit generator, and the
          composable UI library. Read it, fork it, or point the chat kit at your own app and drop a
          Reflex agent into it.
        </p>
        <p className="mt-4 text-sm text-zinc-500">
          <TokenStream text="Streamed to you by an agent that read this page's source before writing it." />
        </p>
      </section>
    </main>
  );
}
