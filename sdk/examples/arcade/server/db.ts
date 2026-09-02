/**
 * Postgres storage for the arcade: users, games, suggestions, and the
 * general chat. All access goes through the typed helpers below so row
 * shapes live in exactly one place, and all of it runs against `SqlDriver`
 * (see `sql.ts`) so the same queries serve an embedded PGLite data dir
 * locally and a real Postgres server when hosted.
 */
import { type ArcadeStore, type Row, type SqlDriver, openDriver } from './sql.ts';
import { newId, newToken } from './ids.ts';

export interface UserRow {
  id: string;
  name: string;
  token: string;
  /** Small data-URL image, or empty for the initials fallback. */
  avatar: string;
  /** Short profile description, shown in chat hover cards. */
  bio: string;
  /** The saved Reflex key game creation runs under (user-level setting). */
  activeKeyId: string | null;
  /**
   * The shared link this player arrived through (`x`, `bluesky`, `link`,
   * ...), or null for a direct visit. Written once, at join: it answers
   * "did that post bring anyone back?" and nothing else reads it.
   */
  joinedVia: string | null;
  createdAt: string;
}

/** A named Reflex personal API key. Users can hold several and pick per game. */
export interface ReflexKeyRow {
  id: string;
  userId: string;
  name: string;
  apiKey: string;
  org: string | null;
  createdAt: string;
}

export type GameStatus = 'creating' | 'live' | 'error' | 'stopped';

export interface GameRow {
  id: string;
  ownerId: string;
  /** The Reflex key this game's agent runs under. */
  keyId: string | null;
  title: string;
  prompt: string;
  agentId: string;
  agentStreamId: string;
  agentType: string | null;
  model: string | null;
  status: GameStatus;
  agentStatus: string | null;
  isPublic: boolean;
  autoApprove: boolean;
  daemonUrl: string | null;
  daemonName: string | null;
  /** How many times the game view has been opened. */
  plays: number;
  /** Agent-authored cover art, stored as a data URL captured off its daemon. */
  previewArt: string | null;
  /** Agent-authored square icon, stored as a data URL. */
  iconArt: string | null;
  /** Optional looping animated cover (animated SVG/GIF/WebP data URL). */
  previewAnimArt: string | null;
  /** Bumped whenever either art file changes; cache-busts art URLs. */
  artVersion: number;
  /**
   * Version of the standing rules this game's agent has been told
   * (`GAME_BRIEF_VERSION`). A system prompt is fixed at launch, so games
   * below the current version get the difference appended to a turn.
   */
  briefVersion: number;
  /** What the agent is working on right now (suggestion body or owner prompt). */
  currentTask: string | null;
  currentTaskKind: 'suggestion' | 'prompt' | null;
  createdAt: string;
}

export type SuggestionStatus = 'pending' | 'approved' | 'working' | 'done' | 'rejected';

export type SuggestionCategory = 'bug' | 'improvement' | 'feature';

export interface SuggestionRow {
  id: string;
  gameId: string;
  authorId: string;
  authorName: string;
  body: string;
  status: SuggestionStatus;
  category: SuggestionCategory;
  /** Total hearts from viewers; the dispatcher works most-hearted first. */
  hearts: number;
  /** Whether the requesting user hearted it (GET responses only). */
  heartedByMe?: boolean;
  /**
   * The owner's public note: a rejection reason, or a comment left on the
   * suggestion in any status. Visible to everyone with access to the game.
   */
  ownerNote: string | null;
  createdAt: string;
  approvedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** When the author last rewrote it, or null if never edited. */
  editedAt: string | null;
  /**
   * How many times the agent has been sent this suggestion. Durable rather
   * than per-watcher state: the re-queue safety valve has to survive an
   * arcade restart, or a suggestion the agent never finishes is re-sent
   * three more times on every boot.
   */
  dispatches: number;
}

/**
 * A "Connect with Reflex" device flow waiting on a player's approval.
 * Durable on purpose: the poll loop outlives a deploy, and a flow held in
 * process memory forced the player to start over whenever one landed.
 */
export interface PendingConnectRow {
  /** Opaque id the browser polls with. */
  id: string;
  /** Arcade player this flow belongs to; nobody else may poll it. */
  userId: string;
  /** Reflex's poll secret. Never sent to a browser. */
  deviceCode: string;
  /** Short code shown on both ends so the player can match them up. */
  userCode: string;
  /** Epoch ms after which Reflex would reject the code anyway. */
  expiresAt: number;
}

export interface ChatMessageRow {
  id: string;
  /** The game room this message belongs to. */
  gameId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  authorBio: string;
  body: string;
  createdAt: string;
}

const SCHEMA = `
  create table if not exists users (
    id text primary key,
    name text not null,
    token text unique not null,
    created_at timestamptz not null default now()
  );
  create table if not exists reflex_keys (
    id text primary key,
    user_id text not null references users(id),
    name text not null,
    api_key text not null,
    org text,
    created_at timestamptz not null default now()
  );
  create table if not exists games (
    id text primary key,
    owner_id text not null references users(id),
    key_id text,
    title text not null,
    prompt text not null,
    agent_id text not null,
    agent_stream_id text not null,
    agent_type text,
    model text,
    status text not null default 'creating',
    agent_status text,
    is_public boolean not null default false,
    auto_approve boolean not null default false,
    daemon_url text,
    daemon_name text,
    created_at timestamptz not null default now()
  );
  create table if not exists suggestions (
    id text primary key,
    game_id text not null references games(id),
    author_id text not null references users(id),
    body text not null,
    status text not null default 'pending',
    created_at timestamptz not null default now(),
    approved_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz
  );
  create table if not exists chat_messages (
    id text primary key,
    author_id text not null references users(id),
    body text not null,
    created_at timestamptz not null default now()
  );
  create index if not exists suggestions_game_status_idx on suggestions (game_id, status);
  alter table users add column if not exists active_key_id text;
  alter table chat_messages add column if not exists game_id text;
  create index if not exists chat_messages_game_idx on chat_messages (game_id, created_at);
  alter table users add column if not exists avatar text not null default '';
  alter table users add column if not exists joined_via text;
  alter table users add column if not exists bio text not null default '';
  alter table games add column if not exists plays integer not null default 0;
  alter table games add column if not exists preview_art text;
  alter table games add column if not exists icon_art text;
  alter table games add column if not exists art_version integer not null default 0;
  alter table games add column if not exists preview_anim_art text;
  alter table games add column if not exists current_task text;
  alter table games add column if not exists current_task_kind text;
  alter table games add column if not exists brief_version integer not null default 0;
  alter table suggestions add column if not exists category text not null default 'improvement';
  alter table suggestions add column if not exists owner_note text;
  alter table suggestions add column if not exists edited_at timestamptz;
  alter table suggestions add column if not exists dispatches integer not null default 0;
  create table if not exists suggestion_hearts (
    suggestion_id text not null references suggestions(id),
    user_id text not null references users(id),
    created_at timestamptz not null default now(),
    primary key (suggestion_id, user_id)
  );
  create table if not exists pending_connects (
    id text primary key,
    user_id text not null references users(id),
    device_code text not null,
    user_code text not null,
    expires_at timestamptz not null
  );
  -- One dispatch in flight per game, enforced by the database because two
  -- arcade processes run during a deploy's overlap window. The update first
  -- re-queues all but the oldest of any duplicate working rows left from
  -- before this index existed, or creating it would fail the boot.
  update suggestions set status = 'approved', started_at = null
    where status = 'working' and id not in (
      select distinct on (game_id) id from suggestions where status = 'working'
      order by game_id, started_at asc nulls last, id asc
    );
  create unique index if not exists suggestions_one_working_per_game
    on suggestions (game_id) where status = 'working';
`;

function str(row: Row, key: string): string {
  return String(row[key]);
}

/**
 * A unique-constraint rejection, on either driver: node-postgres exposes
 * SQLSTATE 23505 as `code`, PGLite only the message text.
 */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return (
    code === '23505' || (typeof message === 'string' && message.includes('duplicate key value'))
  );
}

function strOrNull(row: Row, key: string): string | null {
  const value = row[key];
  return value == null ? null : String(value);
}

function timestamp(row: Row, key: string): string {
  const value = row[key];
  return value instanceof Date ? value.toISOString() : String(value);
}

function timestampOrNull(row: Row, key: string): string | null {
  const value = row[key];
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toUser(row: Row): UserRow {
  return {
    id: str(row, 'id'),
    name: str(row, 'name'),
    token: str(row, 'token'),
    avatar: strOrNull(row, 'avatar') ?? '',
    bio: strOrNull(row, 'bio') ?? '',
    activeKeyId: strOrNull(row, 'active_key_id'),
    joinedVia: strOrNull(row, 'joined_via'),
    createdAt: timestamp(row, 'created_at'),
  };
}

function toReflexKey(row: Row): ReflexKeyRow {
  return {
    id: str(row, 'id'),
    userId: str(row, 'user_id'),
    name: str(row, 'name'),
    apiKey: str(row, 'api_key'),
    org: strOrNull(row, 'org'),
    createdAt: timestamp(row, 'created_at'),
  };
}

function toGame(row: Row): GameRow {
  return {
    id: str(row, 'id'),
    ownerId: str(row, 'owner_id'),
    keyId: strOrNull(row, 'key_id'),
    title: str(row, 'title'),
    prompt: str(row, 'prompt'),
    agentId: str(row, 'agent_id'),
    agentStreamId: str(row, 'agent_stream_id'),
    agentType: strOrNull(row, 'agent_type'),
    model: strOrNull(row, 'model'),
    status: str(row, 'status') as GameStatus,
    agentStatus: strOrNull(row, 'agent_status'),
    isPublic: Boolean(row['is_public']),
    autoApprove: Boolean(row['auto_approve']),
    daemonUrl: strOrNull(row, 'daemon_url'),
    daemonName: strOrNull(row, 'daemon_name'),
    plays: Number(row['plays'] ?? 0),
    previewArt: strOrNull(row, 'preview_art'),
    iconArt: strOrNull(row, 'icon_art'),
    previewAnimArt: strOrNull(row, 'preview_anim_art'),
    artVersion: Number(row['art_version'] ?? 0),
    briefVersion: Number(row['brief_version'] ?? 0),
    currentTask: strOrNull(row, 'current_task'),
    currentTaskKind: strOrNull(row, 'current_task_kind') as GameRow['currentTaskKind'],
    createdAt: timestamp(row, 'created_at'),
  };
}

function toSuggestion(row: Row): SuggestionRow {
  return {
    id: str(row, 'id'),
    gameId: str(row, 'game_id'),
    authorId: str(row, 'author_id'),
    authorName: str(row, 'author_name'),
    body: str(row, 'body'),
    status: str(row, 'status') as SuggestionStatus,
    category: (strOrNull(row, 'category') ?? 'improvement') as SuggestionCategory,
    hearts: Number(row['hearts'] ?? 0),
    ...(row['hearted_by_me'] != null ? { heartedByMe: Boolean(row['hearted_by_me']) } : {}),
    ownerNote: strOrNull(row, 'owner_note'),
    createdAt: timestamp(row, 'created_at'),
    approvedAt: timestampOrNull(row, 'approved_at'),
    startedAt: timestampOrNull(row, 'started_at'),
    completedAt: timestampOrNull(row, 'completed_at'),
    editedAt: timestampOrNull(row, 'edited_at'),
    dispatches: Number(row['dispatches'] ?? 0),
  };
}

function toChatMessage(row: Row): ChatMessageRow {
  return {
    id: str(row, 'id'),
    gameId: str(row, 'game_id'),
    authorId: str(row, 'author_id'),
    authorName: str(row, 'author_name'),
    authorAvatar: strOrNull(row, 'author_avatar') ?? '',
    authorBio: strOrNull(row, 'author_bio') ?? '',
    body: str(row, 'body'),
    createdAt: timestamp(row, 'created_at'),
  };
}

const SUGGESTION_SELECT = `
  select s.*, u.name as author_name,
    (select count(*)::int from suggestion_hearts h where h.suggestion_id = s.id) as hearts
  from suggestions s join users u on u.id = s.author_id
`;

/** Same as SUGGESTION_SELECT plus whether $FOR_USER hearted each row. */
const SUGGESTION_SELECT_FOR = (userParam: string) => `
  select s.*, u.name as author_name,
    (select count(*)::int from suggestion_hearts h where h.suggestion_id = s.id) as hearts,
    exists(
      select 1 from suggestion_hearts h where h.suggestion_id = s.id and h.user_id = ${userParam}
    ) as hearted_by_me
  from suggestions s join users u on u.id = s.author_id
`;

export class ArcadeDb {
  private constructor(private readonly pg: SqlDriver) {}

  static async open(store: ArcadeStore): Promise<ArcadeDb> {
    const driver = await openDriver(store);
    await driver.exec(SCHEMA);
    await ArcadeDb.migrateLegacySingleKey(driver);
    return new ArcadeDb(driver);
  }

  /**
   * Write a backup, for stores that need the arcade to take one; returns
   * the file written, or null when the store snapshots itself (see
   * `SqlDriver.snapshot`).
   */
  snapshot(keep?: number): Promise<string | null> {
    return this.pg.snapshot(keep);
  }

  /** Round-trip to the database, for the deployment healthcheck. */
  async ping(): Promise<void> {
    await this.pg.query(`select 1`);
  }

  /**
   * Databases created before named keys stored one key directly on the user
   * row. Move those into reflex_keys (attaching existing games to them) and
   * drop the old columns; the column check makes this a one-time step.
   */
  private static async migrateLegacySingleKey(pg: SqlDriver): Promise<void> {
    const { rows } = await pg.query<Row>(
      `select 1 from information_schema.columns
       where table_name = 'users' and column_name = 'reflex_api_key'`,
    );
    if (rows.length === 0) return;
    const { rows: legacy } = await pg.query<Row>(
      `select id, reflex_api_key, reflex_org from users where reflex_api_key is not null`,
    );
    for (const row of legacy) {
      const keyId = newId('key');
      await pg.query(
        `insert into reflex_keys (id, user_id, name, api_key, org) values ($1, $2, $3, $4, $5)`,
        [
          keyId,
          str(row, 'id'),
          'default',
          str(row, 'reflex_api_key'),
          strOrNull(row, 'reflex_org'),
        ],
      );
      await pg.query(`update games set key_id = $1 where owner_id = $2 and key_id is null`, [
        keyId,
        str(row, 'id'),
      ]);
    }
    await pg.exec(
      `alter table users drop column if exists reflex_api_key;
       alter table users drop column if exists reflex_org;`,
    );
  }

  async close(): Promise<void> {
    await this.pg.close();
  }

  // -- users ----------------------------------------------------------------

  /**
   * Create a player. `via` is the shared link they arrived through, kept so
   * the arcade can tell which posts actually return people.
   */
  async createUser(name: string, via: string | null = null): Promise<UserRow> {
    const { rows } = await this.pg.query<Row>(
      `insert into users (id, name, token, joined_via) values ($1, $2, $3, $4) returning *`,
      [newId('usr'), name, newToken(), via],
    );
    return toUser(rows[0]!);
  }

  /** How many players joined through each shared link, most-effective first. */
  async joinsBySource(): Promise<{ source: string; joins: number }[]> {
    const { rows } = await this.pg.query<Row>(
      `select joined_via as source, count(*)::int as joins from users
       where joined_via is not null group by joined_via order by joins desc, source`,
    );
    return rows.map((row) => ({ source: str(row, 'source'), joins: Number(row['joins'] ?? 0) }));
  }

  async userByToken(token: string): Promise<UserRow | null> {
    const { rows } = await this.pg.query<Row>(`select * from users where token = $1`, [token]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async userById(id: string): Promise<UserRow | null> {
    const { rows } = await this.pg.query<Row>(`select * from users where id = $1`, [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  // -- reflex keys ------------------------------------------------------

  async createReflexKey(input: {
    userId: string;
    name: string;
    apiKey: string;
    org: string | null;
  }): Promise<ReflexKeyRow> {
    const { rows } = await this.pg.query<Row>(
      `insert into reflex_keys (id, user_id, name, api_key, org)
       values ($1, $2, $3, $4, $5) returning *`,
      [newId('key'), input.userId, input.name, input.apiKey, input.org],
    );
    return toReflexKey(rows[0]!);
  }

  async keysForUser(userId: string): Promise<ReflexKeyRow[]> {
    const { rows } = await this.pg.query<Row>(
      `select * from reflex_keys where user_id = $1 order by created_at asc`,
      [userId],
    );
    return rows.map(toReflexKey);
  }

  async keyById(id: string): Promise<ReflexKeyRow | null> {
    const { rows } = await this.pg.query<Row>(`select * from reflex_keys where id = $1`, [id]);
    return rows[0] ? toReflexKey(rows[0]) : null;
  }

  async deleteReflexKey(id: string): Promise<void> {
    await this.pg.query(`update users set active_key_id = null where active_key_id = $1`, [id]);
    await this.pg.query(`delete from reflex_keys where id = $1`, [id]);
  }

  async setKeyOrg(keyId: string, org: string): Promise<void> {
    await this.pg.query(`update reflex_keys set org = $2 where id = $1`, [keyId, org]);
  }

  async setActiveKey(userId: string, keyId: string): Promise<void> {
    await this.pg.query(`update users set active_key_id = $2 where id = $1`, [userId, keyId]);
  }

  /** The user's saved key for launching agents: active if set, else oldest. */
  async activeKeyForUser(user: UserRow): Promise<ReflexKeyRow | null> {
    if (user.activeKeyId) {
      const key = await this.keyById(user.activeKeyId);
      if (key && key.userId === user.id) return key;
    }
    const keys = await this.keysForUser(user.id);
    return keys[0] ?? null;
  }

  async countGamesUsingKey(keyId: string): Promise<number> {
    const { rows } = await this.pg.query<Row>(
      `select count(*)::int as n from games where key_id = $1`,
      [keyId],
    );
    return Number(rows[0]?.['n'] ?? 0);
  }

  /**
   * Credentials a game's agent runs under: its chosen key, falling back to
   * the owner's oldest key (covers rows from before per-game keys).
   */
  async credsForGame(game: GameRow): Promise<ReflexKeyRow | null> {
    if (game.keyId) {
      const key = await this.keyById(game.keyId);
      if (key) return key;
    }
    const keys = await this.keysForUser(game.ownerId);
    return keys[0] ?? null;
  }

  async updateProfile(
    userId: string,
    patch: { name?: string; bio?: string; avatar?: string },
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [userId];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (patch.name !== undefined) add('name', patch.name);
    if (patch.bio !== undefined) add('bio', patch.bio);
    if (patch.avatar !== undefined) add('avatar', patch.avatar);
    if (sets.length === 0) return;
    await this.pg.query(`update users set ${sets.join(', ')} where id = $1`, values);
  }

  /**
   * Store captured art (data URLs); pass only the fields that changed. Any
   * call bumps art_version so clients re-fetch.
   */
  async setGameArt(
    gameId: string,
    art: { previewArt?: string; iconArt?: string; previewAnimArt?: string },
  ): Promise<GameRow | null> {
    const sets: string[] = ['art_version = art_version + 1'];
    const params: unknown[] = [gameId];
    if (art.previewArt !== undefined) {
      params.push(art.previewArt);
      sets.push(`preview_art = $${params.length}`);
    }
    if (art.iconArt !== undefined) {
      params.push(art.iconArt);
      sets.push(`icon_art = $${params.length}`);
    }
    if (art.previewAnimArt !== undefined) {
      params.push(art.previewAnimArt);
      sets.push(`preview_anim_art = $${params.length}`);
    }
    const { rows } = await this.pg.query<Row>(
      `update games set ${sets.join(', ')} where id = $1 returning *`,
      params,
    );
    return rows[0] ? toGame(rows[0]) : null;
  }

  /** Remove a game and everything hanging off it. */
  async deleteGame(gameId: string): Promise<void> {
    await this.pg.query(
      `delete from suggestion_hearts where suggestion_id in
         (select id from suggestions where game_id = $1)`,
      [gameId],
    );
    await this.pg.query(`delete from suggestions where game_id = $1`, [gameId]);
    await this.pg.query(`delete from chat_messages where game_id = $1`, [gameId]);
    await this.pg.query(`delete from games where id = $1`, [gameId]);
  }

  async incrementPlays(gameId: string): Promise<void> {
    await this.pg.query(`update games set plays = plays + 1 where id = $1`, [gameId]);
  }

  // -- pending reflex connects ----------------------------------------------

  async insertPendingConnect(entry: PendingConnectRow): Promise<void> {
    await this.pg.query(
      `insert into pending_connects (id, user_id, device_code, user_code, expires_at)
       values ($1, $2, $3, $4, to_timestamp($5 / 1000.0))`,
      [entry.id, entry.userId, entry.deviceCode, entry.userCode, entry.expiresAt],
    );
  }

  async pendingConnectById(id: string): Promise<PendingConnectRow | null> {
    const { rows } = await this.pg.query<Row>(`select * from pending_connects where id = $1`, [id]);
    const row = rows[0];
    if (!row) return null;
    return {
      id: str(row, 'id'),
      userId: str(row, 'user_id'),
      deviceCode: str(row, 'device_code'),
      userCode: str(row, 'user_code'),
      expiresAt: new Date(timestamp(row, 'expires_at')).getTime(),
    };
  }

  async deletePendingConnect(id: string): Promise<void> {
    await this.pg.query(`delete from pending_connects where id = $1`, [id]);
  }

  /** Drop every flow Reflex would no longer honour. */
  async sweepPendingConnects(now: number): Promise<void> {
    await this.pg.query(
      `delete from pending_connects where expires_at <= to_timestamp($1 / 1000.0)`,
      [now],
    );
  }

  /** Test seam: how many flows are being tracked. */
  async countPendingConnects(): Promise<number> {
    const { rows } = await this.pg.query<Row>(`select count(*)::int as n from pending_connects`);
    return Number(rows[0]?.['n'] ?? 0);
  }

  // -- games ----------------------------------------------------------------

  async createGame(input: {
    ownerId: string;
    keyId: string;
    title: string;
    prompt: string;
    agentId: string;
    agentStreamId: string;
    agentType: string;
    model: string | null;
    isPublic: boolean;
    autoApprove: boolean;
    /**
     * Rules version the launch system prompt carried (`GAME_BRIEF_VERSION`).
     * Defaults to the column default, 0 — "briefed on nothing we know of",
     * which makes the catch-up appendix the safe answer for any game whose
     * creator did not say.
     */
    briefVersion?: number;
  }): Promise<GameRow> {
    const { rows } = await this.pg.query<Row>(
      `insert into games (id, owner_id, key_id, title, prompt, agent_id, agent_stream_id,
                          agent_type, model, is_public, auto_approve, brief_version)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning *`,
      [
        newId('game'),
        input.ownerId,
        input.keyId,
        input.title,
        input.prompt,
        input.agentId,
        input.agentStreamId,
        input.agentType,
        input.model,
        input.isPublic,
        input.autoApprove,
        input.briefVersion ?? 0,
      ],
    );
    return toGame(rows[0]!);
  }

  async gameById(id: string): Promise<GameRow | null> {
    const { rows } = await this.pg.query<Row>(`select * from games where id = $1`, [id]);
    return rows[0] ? toGame(rows[0]) : null;
  }

  async allGames(): Promise<GameRow[]> {
    const { rows } = await this.pg.query<Row>(`select * from games order by created_at desc`);
    return rows.map(toGame);
  }

  /**
   * The shelf a viewer may see: every public game, plus their own when
   * signed in. `null` is the signed-out browser on the landing page — it
   * gets the public games and nothing else.
   */
  async listedGamesFor(userId: string | null): Promise<{ game: GameRow; ownerName: string }[]> {
    const { rows } = await this.pg.query<Row>(
      `select g.*, u.name as owner_name from games g join users u on u.id = g.owner_id
       where g.is_public or g.owner_id = $1 order by g.created_at desc`,
      [userId],
    );
    return rows.map((row) => ({ game: toGame(row), ownerName: str(row, 'owner_name') }));
  }

  async updateGame(
    id: string,
    patch: Partial<
      Pick<
        GameRow,
        | 'status'
        | 'agentStatus'
        | 'isPublic'
        | 'autoApprove'
        | 'daemonUrl'
        | 'daemonName'
        | 'currentTask'
        | 'currentTaskKind'
        | 'briefVersion'
      >
    >,
  ): Promise<GameRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [id];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.agentStatus !== undefined) add('agent_status', patch.agentStatus);
    if (patch.isPublic !== undefined) add('is_public', patch.isPublic);
    if (patch.autoApprove !== undefined) add('auto_approve', patch.autoApprove);
    if (patch.daemonUrl !== undefined) add('daemon_url', patch.daemonUrl);
    if (patch.daemonName !== undefined) add('daemon_name', patch.daemonName);
    if (patch.currentTask !== undefined) add('current_task', patch.currentTask);
    if (patch.currentTaskKind !== undefined) add('current_task_kind', patch.currentTaskKind);
    if (patch.briefVersion !== undefined) add('brief_version', patch.briefVersion);
    if (sets.length === 0) return this.gameById(id);
    const { rows } = await this.pg.query<Row>(
      `update games set ${sets.join(', ')} where id = $1 returning *`,
      values,
    );
    return rows[0] ? toGame(rows[0]) : null;
  }

  // -- suggestions ----------------------------------------------------------

  async createSuggestion(input: {
    gameId: string;
    authorId: string;
    body: string;
    category: SuggestionCategory;
    status: Extract<SuggestionStatus, 'pending' | 'approved'>;
  }): Promise<SuggestionRow> {
    const { rows } = await this.pg.query<Row>(
      `insert into suggestions (id, game_id, author_id, body, category, status, approved_at)
       values ($1, $2, $3, $4, $5, $6, case when $6 = 'approved' then now() end)
       returning id`,
      [newId('sug'), input.gameId, input.authorId, input.body, input.category, input.status],
    );
    return (await this.suggestionById(str(rows[0]!, 'id')))!;
  }

  /**
   * Record that the agent was just sent this suggestion, returning the new
   * total. The counter backs the dispatcher's re-queue safety valve, so it
   * lives in the database: an in-memory count resets with the watcher, and
   * a suggestion the agent never finishes would be re-sent from zero on
   * every arcade restart.
   */
  async countSuggestionDispatch(id: string): Promise<number> {
    const { rows } = await this.pg.query<Row>(
      `update suggestions set dispatches = dispatches + 1 where id = $1 returning dispatches`,
      [id],
    );
    return rows.length > 0 ? Number(rows[0]!['dispatches'] ?? 0) : 0;
  }

  /** Clear the dispatch counter, giving a re-approval a fresh start. */
  async resetSuggestionDispatches(id: string): Promise<void> {
    await this.pg.query(`update suggestions set dispatches = 0 where id = $1`, [id]);
  }

  /**
   * Claim the next dispatch: `approved -> working`, but only while no other
   * suggestion for the same game is already `working`. The per-game guard is
   * what keeps the working slot exclusive ACROSS processes — a deploy's
   * overlap window runs two arcades, and without it each could claim a
   * different approved suggestion and send the agent two turns at once. An
   * in-process lock cannot see the other container; the database can.
   *
   * Two layers, because the NOT EXISTS alone is not airtight: under read
   * committed, concurrent claims of two DIFFERENT rows each check the guard
   * against a snapshot that predates the other's commit, and both would
   * pass. The `suggestions_one_working_per_game` unique index is the
   * backstop — the racing loser hits it and reads as an ordinary lost
   * claim. Returns null when the claim lost — rejected meanwhile, or a
   * dispatch already in flight.
   */
  async claimSuggestionForDispatch(id: string): Promise<SuggestionRow | null> {
    let rows: Row[];
    try {
      ({ rows } = await this.pg.query<Row>(
        `update suggestions set status = 'working', started_at = now()
         where id = $1 and status = 'approved'
           and not exists (
             select 1 from suggestions other
             where other.game_id = suggestions.game_id and other.status = 'working'
           )
         returning id`,
        [id],
      ));
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
    if (rows.length === 0) return null;
    return this.suggestionById(id);
  }

  /** Toggle a heart; returns whether the user now hearts it. */
  async toggleHeart(suggestionId: string, userId: string): Promise<boolean> {
    const { rows } = await this.pg.query<Row>(
      `delete from suggestion_hearts where suggestion_id = $1 and user_id = $2 returning 1 as r`,
      [suggestionId, userId],
    );
    if (rows.length > 0) return false;
    await this.pg.query(
      `insert into suggestion_hearts (suggestion_id, user_id) values ($1, $2)
       on conflict do nothing`,
      [suggestionId, userId],
    );
    return true;
  }

  /** done-suggestion counts per game, one query for a whole shelf. */
  async shippedCounts(gameIds: string[]): Promise<Record<string, number>> {
    if (gameIds.length === 0) return {};
    const params = gameIds.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await this.pg.query<Row>(
      `select game_id, count(*)::int as n from suggestions
       where status = 'done' and game_id in (${params})
       group by game_id`,
      gameIds,
    );
    const out: Record<string, number> = {};
    for (const row of rows) out[str(row, 'game_id')] = Number(row['n'] ?? 0);
    return out;
  }

  async suggestionById(id: string): Promise<SuggestionRow | null> {
    const { rows } = await this.pg.query<Row>(`${SUGGESTION_SELECT} where s.id = $1`, [id]);
    return rows[0] ? toSuggestion(rows[0]) : null;
  }

  async suggestionsForGame(gameId: string, forUserId?: string): Promise<SuggestionRow[]> {
    if (forUserId) {
      const { rows } = await this.pg.query<Row>(
        `${SUGGESTION_SELECT_FOR('$2')} where s.game_id = $1 order by s.created_at asc`,
        [gameId, forUserId],
      );
      return rows.map(toSuggestion);
    }
    const { rows } = await this.pg.query<Row>(
      `${SUGGESTION_SELECT} where s.game_id = $1 order by s.created_at asc`,
      [gameId],
    );
    return rows.map(toSuggestion);
  }

  /**
   * The next approved suggestion the agent should pick up: most hearts
   * first (the audience steers), oldest as the tiebreak.
   */
  async nextApprovedSuggestion(gameId: string): Promise<SuggestionRow | null> {
    const { rows } = await this.pg.query<Row>(
      `${SUGGESTION_SELECT}
       where s.game_id = $1 and s.status = 'approved'
       order by hearts desc, s.approved_at asc, s.created_at asc limit 1`,
      [gameId],
    );
    return rows[0] ? toSuggestion(rows[0]) : null;
  }

  async workingSuggestions(gameId: string): Promise<SuggestionRow[]> {
    const { rows } = await this.pg.query<Row>(
      `${SUGGESTION_SELECT} where s.game_id = $1 and s.status = 'working'`,
      [gameId],
    );
    return rows.map(toSuggestion);
  }

  /**
   * Move a suggestion to `status`. With `onlyIf`, the transition applies
   * atomically only while the current status is one of those — the guard
   * that keeps racing writers (owner actions vs the dispatcher) from
   * overwriting each other. Returns null when nothing was updated.
   */
  async setSuggestionStatus(
    id: string,
    status: SuggestionStatus,
    onlyIf?: SuggestionStatus[],
  ): Promise<SuggestionRow | null> {
    const stamp =
      status === 'approved'
        ? ', approved_at = now()'
        : status === 'working'
          ? ', started_at = now()'
          : status === 'done'
            ? ', completed_at = now()'
            : '';
    const params: unknown[] = [id, status];
    let where = 'id = $1';
    if (onlyIf && onlyIf.length > 0) {
      const slots = onlyIf.map((current) => {
        params.push(current);
        return `$${params.length}`;
      });
      where += ` and status in (${slots.join(', ')})`;
    }
    const { rows } = await this.pg.query<Row>(
      `update suggestions set status = $2${stamp} where ${where} returning id`,
      params,
    );
    if (rows.length === 0) return null;
    return this.suggestionById(id);
  }

  /**
   * Rewrite a suggestion's body/category, but only while its status is one
   * of `onlyIf`. The guard is part of the UPDATE rather than a read-then-
   * write, so an edit racing the dispatcher cannot change text the agent
   * has already been sent: the dispatcher claims `approved -> working`
   * atomically before it reads the body, so either the edit lands first
   * (and the agent gets the new text) or the claim does (and the edit is
   * refused). Returns null when the guard rejected it.
   */
  async editSuggestion(
    id: string,
    patch: { body: string; category: SuggestionCategory },
    onlyIf: SuggestionStatus[],
  ): Promise<SuggestionRow | null> {
    const params: unknown[] = [id, patch.body, patch.category];
    const slots = onlyIf.map((status) => {
      params.push(status);
      return `$${params.length}`;
    });
    const { rows } = await this.pg.query<Row>(
      `update suggestions set body = $2, category = $3, edited_at = now()
       where id = $1 and status in (${slots.join(', ')}) returning id`,
      params,
    );
    if (rows.length === 0) return null;
    return this.suggestionById(id);
  }

  /** Set or clear (null) the owner's public note on a suggestion. */
  async setSuggestionNote(id: string, note: string | null): Promise<SuggestionRow | null> {
    await this.pg.query(`update suggestions set owner_note = $2 where id = $1`, [id, note]);
    return this.suggestionById(id);
  }

  // -- general chat ---------------------------------------------------------

  async createChatMessage(gameId: string, authorId: string, body: string): Promise<ChatMessageRow> {
    const { rows } = await this.pg.query<Row>(
      `insert into chat_messages (id, game_id, author_id, body) values ($1, $2, $3, $4) returning id`,
      [newId('msg'), gameId, authorId, body],
    );
    const id = str(rows[0]!, 'id');
    const { rows: full } = await this.pg.query<Row>(
      `select m.*, u.name as author_name, u.avatar as author_avatar, u.bio as author_bio
       from chat_messages m
       join users u on u.id = m.author_id where m.id = $1`,
      [id],
    );
    return toChatMessage(full[0]!);
  }

  async recentChatMessages(gameId: string, limit = 100): Promise<ChatMessageRow[]> {
    const { rows } = await this.pg.query<Row>(
      `select * from (
         select m.*, u.name as author_name, u.avatar as author_avatar, u.bio as author_bio
         from chat_messages m
         join users u on u.id = m.author_id
         where m.game_id = $1
         order by m.created_at desc limit $2
       ) recent order by created_at asc`,
      [gameId, limit],
    );
    return rows.map(toChatMessage);
  }
}
