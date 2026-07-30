/**
 * Agent list sidebar. Uses the generated SDK functions directly:
 * `listAgents` for the list, `createAgent` to start a new one.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createAgent, listAgents } from '@runloop/reflex-client';

const agentsKey = ['demo', 'agents'] as const;

export interface AgentSidebarProps {
  selectedAgentId: string | null;
  onSelect: (agentId: string) => void;
}

export function AgentSidebar({ selectedAgentId, onSelect }: AgentSidebarProps) {
  const queryClient = useQueryClient();

  const agentsQuery = useQuery({
    queryKey: agentsKey,
    queryFn: async () => {
      const { data } = await listAgents();
      return data.agents;
    },
  });

  const newAgent = useMutation({
    mutationFn: async () => {
      const { data } = await createAgent({
        agentType: 'claude-code',
        name: 'Chat kit demo agent',
        prompt: 'You are a demo agent. Greet the user and answer their questions in chat.',
      });
      return data;
    },
    onSuccess: (agent) => {
      void queryClient.invalidateQueries({ queryKey: agentsKey });
      onSelect(agent.id);
    },
  });

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <h1 className="text-sm font-semibold text-zinc-900">Agents</h1>
        <button
          type="button"
          className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          disabled={newAgent.isPending}
          onClick={() => newAgent.mutate()}
        >
          {newAgent.isPending ? 'Starting…' : 'New agent'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {agentsQuery.isLoading ? (
          <p className="px-2 py-4 text-xs text-zinc-500">Loading agents…</p>
        ) : agentsQuery.isError ? (
          <p className="px-2 py-4 text-xs text-red-600">
            Could not load agents. Check your API key, org, and that the Reflex server is running.
          </p>
        ) : agentsQuery.data && agentsQuery.data.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {agentsQuery.data.map((agent) => (
              <li key={agent.id}>
                <button
                  type="button"
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    agent.id === selectedAgentId
                      ? 'bg-indigo-100 text-indigo-900'
                      : 'text-zinc-700 hover:bg-zinc-100'
                  }`}
                  onClick={() => onSelect(agent.id)}
                >
                  <span className="block truncate">{agent.name}</span>
                  <span className="block text-xs text-zinc-500">{agent.status}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-4 text-xs text-zinc-500">
            No agents yet. Click New agent to start one.
          </p>
        )}
      </div>

      {newAgent.isError ? (
        <p className="border-t border-zinc-200 px-4 py-2 text-xs text-red-600">
          Could not create the agent: {newAgent.error.message}
        </p>
      ) : null}
    </aside>
  );
}
