import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/websocket';
import { requireUserId, RouteScope, type PluginLogger } from '@reflex/plugin-api';
import {
  WORKSTATION_PROTOCOL_VERSION,
  WorkstationClientMessageSchema,
  type WorkstationServerMessage,
} from '@runloop/reflex-workstation';
import {
  WorkstationServiceError,
  type WorkstationRegistryService,
} from './workstation-registry.service.js';

interface WorkstationParams {
  id: string;
}

function handleErr(err: unknown, reply: FastifyReply) {
  if (WorkstationServiceError.is(err)) {
    return reply.status(err.status).send({ error: err.code, message: err.message });
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  return reply.status(500).send({ error: 'internal_error', message });
}

function sendFrame(socket: { send(data: string): void }, frame: WorkstationServerMessage): void {
  try {
    socket.send(JSON.stringify(frame));
  } catch {
    // Socket already closed — the close handler owns cleanup.
  }
}

/**
 * Plugin route paths begin with the declared `routePrefix`
 * (`/workstations`). The full URL paths clients hit (after the global
 * `/api` mount) are:
 *
 *   GET    /api/workstations              — caller's workstations in the active org
 *   GET    /api/workstations/:id/calls    — recent audit rows (owner only)
 *   DELETE /api/workstations/:id          — remove an offline workstation
 *   WS     /api/workstations/connect      — workstation client control channel
 *
 * The WS endpoint is what `reflex-cli connect` dials (with `?token=<api key>
 * &organizationId=<org>`; the global auth middleware resolves both on the
 * upgrade request). The first frame must be `register`; after that the
 * socket carries `tool.call`/`tool.result` and heartbeat frames.
 *
 * RBAC enforcement is autowired from each route's `config.rbac` posture
 * by the host's plugin registration proxy (see `rbac-enforcer.ts` /
 * `injectRbacEnforcementHandler`), so this function no longer needs an
 * `authz` handle to build its own preHandlers.
 */
export function registerWorkstationRoutes(
  app: FastifyInstance,
  registry: WorkstationRegistryService,
  log: PluginLogger,
) {
  app.get(
    '/workstations',
    { config: { rbac: { scope: RouteScope.ActiveOrg, read: 'agents:read' } } },
    async (request, reply) => {
      try {
        const organizationId = request.currentOrganizationId!;
        const userId = requireUserId(request);
        return reply.send({ workstations: await registry.list(organizationId, userId) });
      } catch (err) {
        return handleErr(err, reply);
      }
    },
  );

  app.get<{ Params: WorkstationParams }>(
    '/workstations/:id/calls',
    { config: { rbac: { scope: RouteScope.ActiveOrg, read: 'agents:read' } } },
    async (request, reply) => {
      try {
        const organizationId = request.currentOrganizationId!;
        const userId = requireUserId(request);
        const calls = await registry.listCalls(request.params.id, organizationId, userId);
        return reply.send({ calls });
      } catch (err) {
        return handleErr(err, reply);
      }
    },
  );

  app.delete<{ Params: WorkstationParams }>(
    '/workstations/:id',
    {
      config: { rbac: { scope: RouteScope.ActiveOrg, read: 'agents:read', write: 'agents:write' } },
    },
    async (request, reply) => {
      try {
        const organizationId = request.currentOrganizationId!;
        const userId = requireUserId(request);
        await registry.delete(request.params.id, organizationId, userId);
        return reply.status(204).send();
      } catch (err) {
        return handleErr(err, reply);
      }
    },
  );

  app.get(
    '/workstations/connect',
    {
      websocket: true,
      // OpenTelemetry instrumentation is a no-op for long-lived sockets and
      // produces misleading "incomplete request" spans — disable.
      //
      // Connecting a workstation is gated by `agents:write` — the socket is
      // what ultimately lets agents execute on the machine — same posture as
      // deleting one. The 3-arg route form is required here: the 2-arg form
      // silently drops `config`, and this is the one route in the file where
      // that would silently downgrade the gate to "authenticated" instead of
      // rejecting registration outright, because a websocket upgrade has no
      // separate REST-shaped call site to catch the mistake in review.
      config: {
        otel: false,
        rbac: { scope: RouteScope.ActiveOrg, read: 'agents:read', write: 'agents:write' },
      } as Record<string, unknown>,
    },
    (socket, request: FastifyRequest) => {
      let organizationId: string;
      let userId: string;
      try {
        organizationId = request.currentOrganizationId!;
        userId = requireUserId(request);
      } catch {
        sendFrame(socket, {
          v: WORKSTATION_PROTOCOL_VERSION,
          type: 'error',
          message: 'No active organization for this connection',
        });
        socket.close(1008, 'no active organization');
        return;
      }

      let workstationId: string | null = null;

      socket.on('message', (data: Buffer | string) => {
        let raw: unknown;
        try {
          raw = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
        } catch {
          sendFrame(socket, {
            v: WORKSTATION_PROTOCOL_VERSION,
            type: 'error',
            message: 'Frames must be JSON',
          });
          return;
        }

        if (workstationId) {
          registry.handleMessage(workstationId, raw);
          return;
        }

        // Not registered yet — the only acceptable frame is `register`.
        const parsed = WorkstationClientMessageSchema.safeParse(raw);
        if (!parsed.success || parsed.data.type !== 'register') {
          sendFrame(socket, {
            v: WORKSTATION_PROTOCOL_VERSION,
            type: 'error',
            message: `Expected a v${WORKSTATION_PROTOCOL_VERSION} register frame`,
          });
          socket.close(1002, 'expected register frame');
          return;
        }
        const reg = parsed.data;
        void registry
          .register({
            organizationId,
            userId,
            name: reg.name,
            hostname: reg.hostname,
            platform: reg.platform,
            toolRoot: reg.toolRoot,
            socket,
          })
          .then((workstation) => {
            workstationId = workstation.id;
            sendFrame(socket, {
              v: WORKSTATION_PROTOCOL_VERSION,
              type: 'registered',
              workstation,
            });
          })
          .catch((err: unknown) => {
            log.error(
              { err: err instanceof Error ? err.message : String(err) },
              'workstation registration failed',
            );
            sendFrame(socket, {
              v: WORKSTATION_PROTOCOL_VERSION,
              type: 'error',
              message: 'Registration failed',
            });
            socket.close(1011, 'registration failed');
          });
      });

      socket.on('close', () => {
        if (workstationId) void registry.disconnect(workstationId, socket);
      });
      socket.on('error', (err: Error) => {
        log.warn({ err: err.message, workstationId }, 'workstation socket error');
      });
    },
  );
}
