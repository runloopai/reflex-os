/**
 * Self-sufficient browser smoke test for the arcade demo, run against the
 * ephemeral mock-wired stack (web :5679 -> server :8795 -> mock :8791).
 *
 * Covers round 3: user-level keys (add -> org discovery via
 * getOrganizations -> active key), the getAgentModelSupport-driven catalog
 * (agent + model pickers with provider-key availability), and the
 * chat-kit-scaffolded agent transcript (tool calls, lifecycle notes,
 * read-only viewers).
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const WEB = 'http://localhost:5679';
const API = 'http://localhost:8795';
const results = [];
const check = (name, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${detail}` : ''}`);

const api = async (path, { token, body, method } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
};

// Provision: owner joins, saves a key (org discovered, then picked), and the
// active key drives game creation — no key sent at launch time.
const suffix = Math.random().toString(36).slice(2, 7);
const title = `Neon Runner ${suffix}`;
const { token: ownerToken } = await api('/api/join', { body: { name: `Streamer-${suffix}` } });

const added = await api('/api/me/reflex-keys', {
  token: ownerToken,
  body: { name: 'main org', apiKey: 'rfx_mock_abcd' },
});
check(
  'key add returns discovered orgs',
  added.organizations.length === 2 && added.user.activeKeyId === added.keyId,
  `(${added.organizations.map((o) => o.slug).join(', ')}; active=${added.user.activeKeyId === added.keyId})`,
);
await api(`/api/me/reflex-keys/${added.keyId}`, {
  method: 'PATCH',
  token: ownerToken,
  body: { organizationId: 'org_mock' },
});

const { catalog } = await api('/api/reflex/catalog', { token: ownerToken });
const claude = catalog.agents.find((a) => a.agentType === 'claude-code');
const anthropic = claude?.providers.find((p) => p.id === 'anthropic');
const openai = claude?.providers.find((p) => p.id === 'openai');
check(
  'catalog: enabled agents only, providers with key availability',
  catalog.agents.length === 2 &&
    anthropic?.available === true &&
    anthropic.models.length === 3 &&
    openai?.available === false &&
    claude?.defaultModel === 'claude-sonnet-5',
  `(agents=${catalog.agents.map((a) => a.agentType).join(',')})`,
);

const { game } = await api('/api/games', {
  token: ownerToken,
  body: {
    title,
    prompt: 'endless neon runner',
    agentType: 'claude-code',
    model: 'claude-sonnet-5',
    isPublic: true,
    autoApprove: true,
  },
});
check('game created off saved active key', game.model === 'claude-sonnet-5');

let live = null;
for (let i = 0; i < 24 && !live; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const { game: g } = await api(`/api/games/${game.id}`, { token: ownerToken });
  if (g.status === 'live' && g.daemonUrl) live = g;
}
check('game goes live with daemon url', Boolean(live), `(${live?.daemonUrl})`);

await api('/api/me', {
  method: 'PATCH',
  token: ownerToken,
  body: { bio: 'I build games live on the arcade.' },
});

const browser = await chromium.launch();
const errors = [];

// --- viewer path ---
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
page.on('pageerror', (err) => errors.push(String(err)));
try {
  await page.goto(WEB);
  await page.getByPlaceholder('Your name').fill(`Viewer-${suffix}`);
  await page.getByRole('button', { name: 'Join' }).click();
  await page.getByText('Games built live by agents').waitFor({ timeout: 5000 });

  await page.getByText(title).first().click();
  await page.waitForURL(/\/g\/game_/, { timeout: 5000 });

  const iframe = page.locator('iframe');
  await iframe.waitFor({ timeout: 8000 });
  check('iframe points at daemon', (await iframe.getAttribute('src'))?.includes('/play/') ?? false);

  // Agent art contract: the mock daemon serves /arcade/{icon,preview}.svg and
  // the watcher captures both into the arcade db.
  let arted = null;
  for (let i = 0; i < 40 && !arted; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const { game: g } = await api(`/api/games/${game.id}`, { token: ownerToken });
    if (g.hasPreview && g.hasIcon) arted = g;
  }
  check(
    'agent art captured off the daemon (incl. animated cover)',
    Boolean(arted) && arted.hasPreviewAnim === true,
    `(v${arted?.artVersion}, anim=${arted?.hasPreviewAnim})`,
  );
  const artRes = await fetch(`${API}/api/games/${game.id}/art/preview?v=${arted?.artVersion ?? 0}`);
  check(
    'art endpoint serves the preview image',
    artRes.ok && (artRes.headers.get('content-type')?.startsWith('image/') ?? false),
  );
  await page.goto(WEB);
  await page
    .locator(`img[src*="/api/games/${game.id}/art/preview"]`)
    .first()
    .waitFor({ timeout: 10000 });
  check('game tile wears the agent-drawn cover', true);

  // Hovering the tile plays the game: animated cover, then the live iframe.
  const tile = page.locator(`a[href="/g/${game.id}"]`).first();
  await tile.hover();
  await page
    .locator(`a[href="/g/${game.id}"] img[src*="art/preview-anim"]`)
    .waitFor({ timeout: 5000 });
  await page.locator(`a[href="/g/${game.id}"] iframe`).waitFor({ timeout: 8000 });
  check('hovering the tile plays the live game preview', true);
  await page.mouse.move(10, 10);
  await page.goBack();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();

  // The sidebar defaults to the game chat room; the transcript is one tab over.
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByText('The game is up!', { exact: false }).first().waitFor({ timeout: 8000 });
  const bashTool = await page.getByText('npm install && npm run dev').count();
  const daemonNote = await page.getByText('dev server "game-dev" registered').count();
  check('scaffolded pane renders tool calls + lifecycle', bashTool > 0 && daemonNote > 0);
  check(
    'viewer is read-only (no composer)',
    (await page.getByText('View only', { exact: false }).count()) > 0 &&
      (await page.getByPlaceholder('Send a message').count()) === 0,
  );

  await page.getByRole('button', { name: 'Suggestions' }).click();
  await page.getByRole('button', { name: 'Feature' }).click();
  await page.getByPlaceholder('Suggest a feature or fix').fill('smoke: add rainbow trail');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('smoke: add rainbow trail').first().waitFor({ timeout: 5000 });
  const featureChips = await page.locator('span:has-text("Feature")').count();
  check('suggestion carries its category chip', featureChips > 0);
  await page.getByLabel('Heart suggestion').first().click();
  await page.getByLabel('Unheart suggestion').waitFor({ timeout: 5000 });
  check('heart toggles and counts', true);
  await page.getByText('agent working').first().waitFor({ timeout: 10000 });
  await page.getByText('Working on:', { exact: false }).waitFor({ timeout: 10000 });
  await page.getByText('shipped').first().waitFor({ timeout: 20000 });
  check('suggestion auto-approved, worked, shipped (live UI)', true);

  // Grouped panel: shipped section header, yours chip, and the tile's
  // shipped counter all reflect the finished suggestion.
  await page.getByText('Shipped', { exact: true }).waitFor({ timeout: 8000 });
  await page.getByText('yours', { exact: true }).waitFor({ timeout: 5000 });
  check('panel groups suggestions with a Shipped section + yours chip', true);
  await page.goto(WEB);
  await page
    .getByLabel(/suggestions shipped/)
    .first()
    .waitFor({ timeout: 10000 });
  check('game tile counts shipped suggestions', true);
  await page.goBack();
  await page.getByRole('button', { name: 'Suggestions' }).click();

  // In the transcript, the dispatched prompt reads as a suggestion card.
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByText(/Suggestion · Viewer-/).waitFor({ timeout: 8000 });
  await page.getByText('sent to the agent by the room').waitFor({ timeout: 5000 });
  check('dispatched suggestion renders as a card in the transcript', true);
  await page.getByRole('button', { name: 'Suggestions' }).click();
  await page.getByText('Agent idle', { exact: false }).waitFor({ timeout: 15000 });
  check('agent banner mirrors dispatcher (working -> idle)', true);

  // Game chat room: owner message (posted via API) carries the crown badge;
  // the viewer's own message appears after sending.
  await api(`/api/games/${game.id}/chat`, {
    token: ownerToken,
    body: { body: 'welcome to my game!' },
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByText('welcome to my game!').waitFor({ timeout: 8000 });
  const badge = await page.getByLabel('Game owner').count();
  check('owner message shows crown badge', badge > 0);
  await page.getByPlaceholder('Message the room').fill('hi from a viewer');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('hi from a viewer').waitFor({ timeout: 5000 });
  check('viewer chats in the game room', true);

  // Hover the owner's name -> profile card with avatar/name/bio.
  await page.locator('aside').getByText(`Streamer-${suffix}`).first().hover();
  await page.getByText('I build games live on the arcade.').waitFor({ timeout: 5000 });
  check('profile hover card shows bio', true);

  // Live viewer count chip is present in the header (this page counts).
  const viewerChips = await page.getByText('watching now', { exact: false }).count();
  check('viewer count visible', viewerChips > 0);
  await page.screenshot({ path: '/tmp/arcade-final.png' });

  // The panel collapses to give the game the full stage, and comes back.
  await page.getByLabel('Hide the panel').click();
  await page.waitForTimeout(300);
  const asideGone = (await page.locator('aside').count()) === 0;
  await page.getByLabel('Show the panel').click();
  await page.locator('aside').waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Chat', exact: true }).waitFor({ timeout: 5000 });
  check('panel fully collapses and restores', asideGone);

  // The profile card's button leads to a real profile page with their games.
  await page.locator('aside').getByText(`Streamer-${suffix}`).first().hover();
  await page.getByRole('button', { name: 'View profile' }).click();
  await page.waitForURL(/\/u\//, { timeout: 5000 });
  await page.getByRole('heading', { name: `Streamer-${suffix}` }).waitFor({ timeout: 5000 });
  await page.getByText('I build games live on the arcade.').waitFor({ timeout: 5000 });
  await page.getByText(title).first().waitFor({ timeout: 5000 });
  check('user reference opens a profile page with their games', true);

  // At phone widths the profile pill stays pinned to the right edge.
  await page.setViewportSize({ width: 380, height: 800 });
  await page.waitForTimeout(400);
  const pill = await page
    .getByRole('button', { name: `Viewer-${suffix}` })
    .first()
    .boundingBox();
  check(
    'nav profile pill right-justified at narrow width',
    Boolean(pill && pill.x + pill.width > 340),
    `(right edge ${pill ? Math.round(pill.x + pill.width) : '?'})`,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
} catch (err) {
  check('viewer smoke', false, String(err).slice(0, 250));
  await page.screenshot({ path: '/tmp/arcade-fail.png' }).catch(() => {});
}

// --- connect path: a new player gets a key without pasting one ---
//
// The whole point of "Connect with Reflex": the player never sees a
// credential. The arcade starts Reflex's device flow, the player approves on
// Reflex's own page (here, the mock's stand-in), and the key comes back
// already bound to the org they picked.
const connectContext = await browser.newContext({ viewport: { width: 1100, height: 950 } });
const connectPage = await connectContext.newPage();
connectPage.on('pageerror', (err) => errors.push(String(err)));
try {
  const { token: joinerToken } = await api('/api/join', { body: { name: `Connector-${suffix}` } });
  await connectPage.addInitScript(
    (t) => localStorage.setItem('reflex-arcade:token', t),
    joinerToken,
  );
  await connectPage.goto(`${WEB}/games/new`);
  await connectPage.getByText('No connection yet', { exact: false }).waitFor({ timeout: 8000 });

  // Clicking connect shows the code Reflex is about to ask about, and opens
  // the approval page (a popup, or the link when the browser blocks it).
  const popup = connectContext.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await connectPage.getByTestId('connect-button').click();
  const waiting = connectPage.getByTestId('connect-waiting');
  await waiting.waitFor({ timeout: 8000 });
  const shownCode = (await connectPage.getByTestId('connect-code').textContent())?.trim() ?? '';
  const approveUrl = await connectPage
    .getByRole('link', { name: /Open the approval page/ })
    .getAttribute('href');
  check(
    'connect shows the user code and links the approval page',
    /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(shownCode) && (approveUrl?.includes(shownCode) ?? false),
    `(${shownCode})`,
  );

  const approvalPage = (await popup) ?? (await connectContext.newPage());
  if (approvalPage.url() === 'about:blank') await approvalPage.goto(approveUrl);
  await approvalPage.getByText(shownCode).waitFor({ timeout: 8000 });
  check('approval page is about this connection', true);

  // Cancelling hands the panel back rather than stranding the player in a
  // wait for an approval that is never coming.
  await connectPage.getByRole('button', { name: 'Cancel' }).click();
  await connectPage.getByTestId('connect-button').waitFor({ timeout: 8000 });
  check(
    'cancel drops the pending flow and restores the button',
    (await connectPage.getByTestId('connect-waiting').count()) === 0,
  );

  // Start a second flow and take it all the way. Approve for the second org,
  // so the saved key proves it carries the org the player chose rather than
  // a default.
  const popup2 = connectContext.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await connectPage.getByTestId('connect-button').click();
  await connectPage.getByTestId('connect-waiting').waitFor({ timeout: 8000 });
  const secondCode = (await connectPage.getByTestId('connect-code').textContent())?.trim() ?? '';
  check('a cancelled flow can be started again', secondCode !== shownCode, `(${secondCode})`);
  const secondApproval = (await popup2) ?? (await connectContext.newPage());
  if (secondApproval.url() === 'about:blank') {
    await secondApproval.goto(
      await connectPage.getByRole('link', { name: /Open the approval page/ }).getAttribute('href'),
    );
  }
  await secondApproval.getByText(secondCode).waitFor({ timeout: 8000 });
  await approvalPage.close();
  const approvalTarget = secondApproval;
  await approvalTarget.selectOption('#org', 'org_mock2');
  await approvalTarget.getByRole('button', { name: 'Approve' }).click();
  await approvalTarget.getByText('Approved.', { exact: false }).waitFor({ timeout: 8000 });

  // Back on the arcade: the key lands active, named and scoped, with no
  // org picker to finish and nothing pasted.
  await connectPage.getByText('org: org_mock2').waitFor({ timeout: 20000 });
  await connectPage.getByText('Second Org', { exact: false }).waitFor({ timeout: 5000 });
  const stillWaiting = await connectPage.getByTestId('connect-waiting').count();
  const needsOrg = await connectPage.getByText('needs an organization').count();
  check(
    'approved connection saves an active, org-scoped key',
    stillWaiting === 0 && needsOrg === 0,
  );

  const { user: connected } = await api('/api/me', { token: joinerToken });
  check(
    'connected key is the active one and never left the server',
    connected.keys.length === 1 &&
      connected.activeKeyId === connected.keys[0].id &&
      connected.keys[0].org === 'org_mock2' &&
      connected.keys[0].preview.startsWith('rfx_...'),
    `(${connected.keys[0]?.name} / ${connected.keys[0]?.org})`,
  );
  await connectPage.screenshot({ path: '/tmp/arcade-connect.png', fullPage: true });
} catch (err) {
  check('connect smoke', false, String(err).slice(0, 250));
  await connectPage.screenshot({ path: '/tmp/arcade-connect-fail.png' }).catch(() => {});
}
await connectContext.close();

// --- owner path: form pickers + composer ---
const ownerPage = await browser.newPage({ viewport: { width: 1100, height: 950 } });
ownerPage.on('pageerror', (err) => errors.push(String(err)));
try {
  await ownerPage.addInitScript((t) => localStorage.setItem('reflex-arcade:token', t), ownerToken);
  await ownerPage.goto(`${WEB}/games/new`);
  await ownerPage.getByText('Reflex connection').waitFor({ timeout: 8000 });
  await ownerPage.getByText('org: org_mock').waitFor({ timeout: 8000 });
  // <option>s inside a closed <select> count as hidden; assert attachment.
  await ownerPage
    .locator('option[value="claude-code"]')
    .first()
    .waitFor({ state: 'attached', timeout: 8000 });
  const openaiGroup = await ownerPage
    .locator('optgroup[label*="OpenAI"][label*="no provider key"]')
    .count();
  const codexOption = await ownerPage.locator('option[value="codex"]').count();
  check('form: connection card + catalog-driven pickers', openaiGroup > 0 && codexOption > 0);
  await ownerPage.screenshot({ path: '/tmp/arcade-newgame.png', fullPage: true });

  // My games page lists the owner's game; the public page has the sorter.
  await ownerPage.goto(`${WEB}/mine`);
  await ownerPage.getByText('My games').first().waitFor({ timeout: 8000 });
  await ownerPage.getByText(title).waitFor({ timeout: 8000 });
  check('my games page lists own game', true);
  await ownerPage.getByLabel(`Settings for ${title}`).click();
  await ownerPage.waitForURL(/\/settings$/, { timeout: 5000 });
  await ownerPage.getByText('Danger zone').waitFor({ timeout: 5000 });
  check('settings reachable from the My games tile', true);
  await ownerPage.goBack();
  await ownerPage.goto(`${WEB}/`);
  await ownerPage.getByLabel('Sort').selectOption('plays-desc');
  await ownerPage.getByText(title).waitFor({ timeout: 8000 });
  check('games page sorts by plays', true);

  await ownerPage.goto(`${WEB}/g/${game.id}`);
  await ownerPage.getByLabel('Game settings').waitFor({ timeout: 8000 });
  await ownerPage.getByRole('button', { name: 'Agent', exact: true }).click();
  await ownerPage.getByPlaceholder('Send a message', { exact: false }).waitFor({ timeout: 8000 });
  check('owner sees composer + settings link', true);

  // Settings page: switches round-trip through the API.
  await ownerPage.goto(`${WEB}/g/${game.id}/settings`);
  await ownerPage.getByText('Auto-approve suggestions').waitFor({ timeout: 8000 });
  await ownerPage.getByText('Danger zone').waitFor({ timeout: 8000 });
  await ownerPage.getByText('Auto-approve suggestions').click();
  let flipped = false;
  for (let i = 0; i < 20 && !flipped; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const { game: g } = await api(`/api/games/${game.id}`, { token: ownerToken });
    flipped = g.autoApprove === false;
  }
  check('settings switches persist (auto-approve off)', flipped);
  await ownerPage.getByText('Auto-approve suggestions').click();
  let restored = false;
  for (let i = 0; i < 20 && !restored; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const { game: g } = await api(`/api/games/${game.id}`, { token: ownerToken });
    restored = g.autoApprove === true;
  }
  check('settings switches persist (auto-approve back on)', restored);
  await ownerPage.goto(`${WEB}/g/${game.id}`);
  await ownerPage.getByRole('button', { name: 'Agent', exact: true }).click();
  await ownerPage.getByPlaceholder('Send a message', { exact: false }).waitFor({ timeout: 8000 });

  // Drag & drop a file onto the composer -> attachment chip appears.
  const dt = await ownerPage.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    return dt;
  });
  await ownerPage.dispatchEvent('aside form', 'drop', { dataTransfer: dt });
  await ownerPage.getByText('notes.txt').waitFor({ timeout: 5000 });
  check('drag & drop attaches a file chip', true);
  // Remove the chip again so the interrupt send is text-only.
  await ownerPage.getByLabel('Remove notes.txt').click();

  // Interrupt: send a message, wait for the running state, hit stop.
  await ownerPage.getByPlaceholder('Send a message', { exact: false }).fill('add a scoreboard');
  await ownerPage.getByLabel('Send', { exact: true }).click();
  await ownerPage.getByLabel('Stop the current turn').waitFor({ timeout: 8000 });
  // The owner's prompt becomes the game's visible current task.
  let tasked = null;
  for (let i = 0; i < 20 && !tasked; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const { game: g } = await api(`/api/games/${game.id}`, { token: ownerToken });
    if (g.currentTask === 'add a scoreboard' && g.currentTaskKind === 'prompt') tasked = g;
  }
  check('owner prompt published as the current task', Boolean(tasked));
  await ownerPage.getByLabel('Stop the current turn').click();
  await ownerPage.getByText('turn interrupted').waitFor({ timeout: 8000 });
  check('interrupt stops the turn (stop button + cancelled note)', true);
  await ownerPage.screenshot({ path: '/tmp/arcade-owner.png' });
} catch (err) {
  check('owner smoke', false, String(err).slice(0, 250));
  await ownerPage.screenshot({ path: '/tmp/arcade-owner-fail.png' }).catch(() => {});
}

// Dispatch priority: while a fresh game is still building, approve two
// suggestions and heart the SECOND — the dispatcher must work it first.
try {
  const { game: g2 } = await api('/api/games', {
    token: ownerToken,
    body: {
      title: `Priority ${suffix}`,
      prompt: 'priority test',
      agentType: 'claude-code',
      model: null,
      isPublic: false,
      autoApprove: false,
    },
  });
  const { suggestion: sugA } = await api(`/api/games/${g2.id}/suggestions`, {
    token: ownerToken,
    body: { body: 'first in, no hearts', category: 'improvement' },
  });
  const { suggestion: sugB } = await api(`/api/games/${g2.id}/suggestions`, {
    token: ownerToken,
    body: { body: 'second in, most hearted', category: 'feature' },
  });
  await api(`/api/games/${g2.id}/suggestions/${sugA.id}/approve`, {
    token: ownerToken,
    method: 'POST',
  });
  await api(`/api/games/${g2.id}/suggestions/${sugB.id}/approve`, {
    token: ownerToken,
    method: 'POST',
  });
  await api(`/api/games/${g2.id}/suggestions/${sugB.id}/heart`, {
    token: ownerToken,
    method: 'POST',
  });
  let firstWorked = null;
  for (let i = 0; i < 30 && !firstWorked; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const { suggestions } = await api(`/api/games/${g2.id}/suggestions`, { token: ownerToken });
    firstWorked = suggestions.find((sg) => sg.status === 'working' || sg.status === 'done') ?? null;
  }
  check(
    'dispatcher works the most-hearted suggestion first',
    firstWorked?.id === sugB.id,
    `(first worked: ${firstWorked?.body ?? 'none'})`,
  );

  // Keep the queue non-empty, then check the staged suggestion is labeled.
  await api(`/api/games/${g2.id}/suggestions`, {
    token: ownerToken,
    body: { body: 'third in line', category: 'bug' },
  }).then(({ suggestion }) =>
    api(`/api/games/${g2.id}/suggestions/${suggestion.id}/approve`, {
      token: ownerToken,
      method: 'POST',
    }),
  );
  await ownerPage.goto(`${WEB}/g/${g2.id}`);
  await ownerPage.getByRole('button', { name: 'Suggestions' }).click();
  await ownerPage.getByText('next up').waitFor({ timeout: 10000 });
  check('queue head carries the next-up chip', true);

  // Interrupt mid-suggestion: the cancelled turn must re-queue and re-run,
  // so every suggestion still ends up shipped.
  await ownerPage.getByRole('button', { name: 'Agent', exact: true }).click();
  await ownerPage.getByLabel('Stop the current turn').waitFor({ timeout: 15000 });
  await ownerPage.getByLabel('Stop the current turn').click();
  await ownerPage.getByText('turn interrupted').first().waitFor({ timeout: 8000 });
  let allDone = false;
  for (let i = 0; i < 60 && !allDone; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const { suggestions } = await api(`/api/games/${g2.id}/suggestions`, { token: ownerToken });
    allDone = suggestions.length >= 3 && suggestions.every((sg) => sg.status === 'done');
  }
  check('cancelled turn re-queues and finishes (all shipped after interrupt)', allDone);
  if (process.env.SMOKE_SERVER_LOG) {
    const log = fs.readFileSync(process.env.SMOKE_SERVER_LOG, 'utf8');
    check(
      'server re-queued the cancelled suggestion (log marker)',
      log.includes('re-queueing suggestion'),
    );
  }

  // Stale-running: freeze the agent mid-turn (status stays "running", devbox
  // suspended). A newly approved suggestion must still dispatch and finish.
  const g2record = await api(`/api/games/${g2.id}`, { token: ownerToken });
  await fetch(`http://localhost:8791/api/agents/${g2record.game.agentId}/simulate-stall`, {
    method: 'POST',
  });
  const { suggestion: stallSug } = await api(`/api/games/${g2.id}/suggestions`, {
    token: ownerToken,
    body: { body: 'wake up and do this', category: 'improvement' },
  });
  await api(`/api/games/${g2.id}/suggestions/${stallSug.id}/approve`, {
    token: ownerToken,
    method: 'POST',
  });
  let wokeAndDone = false;
  // Suspended-silence threshold (20s) + reconcile phase (<=30s) + the turn.
  for (let i = 0; i < 120 && !wokeAndDone; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const { suggestions } = await api(`/api/games/${g2.id}/suggestions`, { token: ownerToken });
    wokeAndDone = suggestions.find((sg) => sg.id === stallSug.id)?.status === 'done';
  }
  check('stalled-running agent still takes the next suggestion', wokeAndDone);

  // Owner notes: reject with a reason via the API, leave a note on a done
  // suggestion, then drive the same flows through the UI.
  const { suggestion: sugNo } = await api(`/api/games/${g2.id}/suggestions`, {
    token: ownerToken,
    body: { body: 'smoke: make it pay-to-win', category: 'feature' },
  });
  const rejectedWithReason = await api(`/api/games/${g2.id}/suggestions/${sugNo.id}/reject`, {
    token: ownerToken,
    method: 'POST',
    body: { reason: 'not that kind of game' },
  });
  check(
    'reject stores the optional reason as the owner note',
    rejectedWithReason.suggestion.status === 'rejected' &&
      rejectedWithReason.suggestion.ownerNote === 'not that kind of game',
  );
  const { suggestions: g2Done } = await api(`/api/games/${g2.id}/suggestions`, {
    token: ownerToken,
  });
  const shipped = g2Done.find((sg) => sg.status === 'done');
  const noted = await api(`/api/games/${g2.id}/suggestions/${shipped.id}/note`, {
    token: ownerToken,
    method: 'PUT',
    body: { note: 'crowd favorite, more of this' },
  });
  check(
    'owner leaves a note on a done suggestion',
    noted.suggestion.ownerNote === 'crowd favorite, more of this',
  );
  await ownerPage.getByRole('button', { name: 'Suggestions' }).click();
  await ownerPage.getByText('crowd favorite, more of this').waitFor({ timeout: 8000 });
  // Rejected cards (and their reasons) hide behind the reveal toggle.
  await ownerPage.getByRole('button', { name: /rejected suggestion/ }).click();
  await ownerPage.getByText('not that kind of game').waitFor({ timeout: 8000 });
  check('owner notes render on the cards (rejected revealed on demand)', true);

  // Edit an existing note through the inline editor.
  await ownerPage.getByLabel('Edit the owner note').first().click();
  const noteInput = ownerPage.getByPlaceholder('Add a note (empty clears it)');
  await noteInput.fill('fine, maybe cosmetics only');
  await noteInput.press('Enter');
  await ownerPage.getByText('fine, maybe cosmetics only').waitFor({ timeout: 8000 });
  check('note editor edits a note through the UI', true);

  // Reject through the UI: the button opens the reason editor first.
  const { suggestion: uiRej } = await api(`/api/games/${g2.id}/suggestions`, {
    token: ownerToken,
    body: { body: 'smoke: add loot boxes', category: 'feature' },
  });
  await ownerPage.getByText('smoke: add loot boxes').waitFor({ timeout: 8000 });
  // exact: the "N rejected suggestions hidden — show" toggle also contains "reject".
  await ownerPage.getByRole('button', { name: 'Reject', exact: true }).click();
  const reasonInput = ownerPage.getByPlaceholder('Add a reason (optional)');
  await reasonInput.fill('no gambling');
  await reasonInput.press('Enter');
  await ownerPage.getByText('no gambling').waitFor({ timeout: 8000 });
  let uiRejected = null;
  for (let i = 0; i < 20 && !uiRejected; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const { suggestions } = await api(`/api/games/${g2.id}/suggestions`, { token: ownerToken });
    uiRejected =
      suggestions.find(
        (sg) => sg.id === uiRej.id && sg.status === 'rejected' && sg.ownerNote === 'no gambling',
      ) ?? null;
  }
  check('UI reject flow persists the reason', Boolean(uiRejected));

  // Delete the priority game: confirmation modal -> gone for everyone.
  await ownerPage.goto(`${WEB}/g/${g2.id}/settings`);
  await ownerPage.getByRole('button', { name: 'Delete game' }).click();
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Delete game' }).click();
  await ownerPage.waitForURL(/\/mine/, { timeout: 8000 });
  const goneRes = await fetch(`${API}/api/games/${g2.id}`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  check('owner deletes a game via confirmed modal', goneRes.status === 404);
  const agentGone = await fetch(`http://localhost:8791/api/agents/${g2record.game.agentId}`);
  check('deleting a game tears down its agent', agentGone.status === 404);

  // A game whose agent dies upstream retires itself instead of erroring
  // forever: delete the agent behind g3 and watch the watcher mark it
  // stopped on reconcile.
  const { game: g3 } = await api('/api/games', {
    token: ownerToken,
    body: {
      title: `Lifecycle ${suffix}`,
      prompt: 'lifecycle test',
      agentType: 'claude-code',
      model: null,
      isPublic: false,
      autoApprove: false,
    },
  });
  let g3live = g3;
  for (let i = 0; i < 40 && g3live.status !== 'live'; i++) {
    await new Promise((r) => setTimeout(r, 500));
    ({ game: g3live } = await api(`/api/games/${g3.id}`, { token: ownerToken }));
  }
  await fetch(`http://localhost:8791/api/agents/${g3live.agentId}`, { method: 'DELETE' });
  let retired = false;
  for (let i = 0; i < 90 && !retired; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const { game: now } = await api(`/api/games/${g3.id}`, { token: ownerToken });
    retired = now.status === 'stopped' && now.agentStatus === 'terminated';
  }
  check('externally deleted agent retires the game', retired);
} catch (err) {
  check('dispatch priority', false, String(err).slice(0, 200));
}

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
