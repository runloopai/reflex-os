/**
 * Demo shell: agent sidebar on the left, the scaffolded ChatPane on the
 * right, and a theme switcher that restyles the pane by toggling a CSS
 * class (see index.css for the --reflex-chat-* variables).
 */
import { useState } from 'react';
import { ReflexProvider } from './lib/reflex/reflex-provider';
import { ChatPane } from './components/reflex/chat-pane';
import { AgentSidebar } from './agent-sidebar';
import { readReflexEnv } from './config';

type Theme = 'day' | 'night';

function NotConfigured() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <div className="max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-zinc-900">Connect this demo to Reflex</h1>
        <p className="mt-2 text-sm text-zinc-600">No API key is configured. To run the demo:</p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-zinc-600">
          <li>
            Start the Reflex server (from the repo root: <code>pnpm dev</code>).
          </li>
          <li>
            In the Reflex web app, open <strong>Security &gt; API keys</strong> and mint a personal
            API key (<code>rfx_...</code>).
          </li>
          <li>
            Copy <code>.env.example</code> to <code>.env</code> in this directory and set{' '}
            <code>VITE_REFLEX_API_KEY</code> and <code>VITE_REFLEX_ORG</code>.
          </li>
          <li>Restart the dev server.</li>
        </ol>
      </div>
    </main>
  );
}

function Workspace() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('day');

  return (
    <div className="flex h-screen bg-white">
      <AgentSidebar selectedAgentId={selectedAgentId} onSelect={setSelectedAgentId} />

      <main className={`flex flex-1 flex-col p-4 theme-${theme}`}>
        <div className="mb-3 flex items-center justify-end gap-2">
          <span className="text-xs text-zinc-500">Theme</span>
          {(['day', 'night'] as const).map((name) => (
            <button
              key={name}
              type="button"
              className={`rounded-md border px-2.5 py-1 text-xs ${
                theme === name
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'
              }`}
              onClick={() => setTheme(name)}
            >
              {name}
            </button>
          ))}
        </div>

        {selectedAgentId ? (
          <div className="min-h-0 flex-1">
            <ChatPane agentId={selectedAgentId} />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-sm text-zinc-500">
            Select an agent, or create one to start chatting.
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const env = readReflexEnv();
  if (!env) return <NotConfigured />;

  return (
    <ReflexProvider baseUrl={env.baseUrl} apiKey={env.apiKey} organizationId={env.organizationId}>
      <Workspace />
    </ReflexProvider>
  );
}
