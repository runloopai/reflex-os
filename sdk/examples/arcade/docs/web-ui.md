# Web and UI changes

Deep detail for the web workflow in [`../AGENTS.md`](../AGENTS.md).

## Test surface

- Components get a story in `stories/` with a `play` function — Storybook
  tests are the component test surface. Connected components (socket/api
  wired) are covered by the smoke test instead; keep new components
  presentational where possible so they stay storyable.
- Check: `npm test` (unit + stories), then `npm run shots` against a running
  stack and READ the images. A change isn't "looking good" until you've seen
  it; compare against the previous shots when in doubt.

## View state lives in the URL

View state that says WHERE you are — the game view's panel, whether the
phone's room sheet is over the game, a shelf's sort — belongs in the query
string via `useUrlState`, not in `useState`. Otherwise a refresh silently
moves you and a shared link opens on a different screen. Defaults are never
written (`urlParam` owns that rule), so URLs stay clean, and unknown values
fall back instead of rendering nothing. Two params that move together go
through `useUrlPatch`; two setters in one handler drop the first write.

## Focus and the game iframe

These are keyboard games, and an iframe gets no key events until it holds
focus. `GameStage` claims the keyboard when a game's daemon URL appears —
once per URL, and only while `document.activeElement` is still `body`. Both
halves matter: this view re-renders on every socket frame, and the URL
usually lands minutes in, while someone is mid-sentence in chat. Anything
that closes the room sheet hands focus back through the stage's handle,
before the state flush, because the control that closed it is unmounting.

## Popovers

Popovers portal to `document.body` and position against the trigger's rect
(`Tip`, `ShareButton`). An absolutely-positioned one is clipped: the
suggestions panel is a scroller and the hero is `overflow-hidden`. Measure
the height of anything taller than a couple of rows against a 342px
landscape phone and spend `short:` on it — the story runner's viewport is
fixed, so no play function will catch this for you.

## Fullscreen is two features

`web/src/lib/fullscreen.ts`, `hooks/useFullscreen.ts`: the Fullscreen API
removes the BROWSER's chrome and only it can, while the nav, sidebar and dock
are removed by the `.stage-immersive` CSS. iPhone Safari has no element
fullscreen at all, so the CSS half must stand alone — and the mode stays out
of the URL because a request needs a user gesture, so a restored
`?fullscreen=1` cannot be honoured on load.

## Look

Dark zinc base, neon violet/fuchsia accents, glass borders
(`border-white/10 bg-zinc-900/50`), performative-ui for the pizzazz
(Aurora, AsciiHero, GradientText, WordRoll, StatCounter, BigBack). Sleek
first, fun second, never busy — put a scrim under copy that sits on
animated backgrounds.

## Mobile is a first-class target

People play the games and suggest from phones. Below `lg` the stream view is
the game, full screen — the app nav hides itself, and chat / agent /
suggestions open over the game as sheets from `PanelDock`. Six rules the
layout depends on:

1. One React tree at both breakpoints (the sheet and the sidebar are the
   same `aside` under `max-lg:`/`lg:`), so rotating a phone never remounts a
   live transcript.
2. Size touch targets with `pointer-coarse:`, never viewport width, because
   a landscape phone is 750px wide and still a thumb.
3. Composers are 16px on coarse pointers or iOS zooms the page on focus and
   strands them behind the keyboard.
4. The game view's header density comes from the STAGE's measured width
   (`stageDensity`), not the viewport — a dragged sidebar can leave the stage
   under 300px on a laptop.
5. Collapsing the sidebar is a desktop preference applied in CSS, so a phone
   that inherited it from localStorage still gets the room.
6. Viewport heights are `dvh`, never `vh` — on iOS `100vh` is the LARGE
   viewport, so a `vh` box around a `dvh` one is taller than the screen by
   the browser toolbars and leaves a strip of background below the dock that
   scrolls into view.

Rows that touch a screen edge wear `safe-x`. Check phone portrait AND
landscape before calling it done — and on a real iPhone, where Chromium
cannot help you: headless `dvh` and `vh` are the same number.

## Tailwind v4 trap

performative-ui ships UNLAYERED CSS, which beats Tailwind's layered
utilities. Positional overrides on pui components (`position`, `inset`) must
be inline `style={{...}}`, or they silently no-op (collapsed AsciiHero
canvas, aurora stretching the page).
