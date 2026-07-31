import { describe, it, expect } from 'vitest';
import {
  buildAgentRunReference,
  sanitizeAgentRunTitle,
  parseAgentRunReferences,
  hasAgentRunReference,
  expandAgentRunReferences,
  wrapAgentRunContext,
  splitAgentRunContextBlocks,
  splitAgentRunMarkers,
  parseComposerReferences,
  normalizeAgentRunReferences,
} from './agent-reference.js';

describe('sanitizeAgentRunTitle', () => {
  it('strips marker-breaking characters and collapses whitespace', () => {
    expect(sanitizeAgentRunTitle('Fix [bug] (urgent)\nnow')).toBe('Fix bug urgent now');
  });
  it('trims to empty when only punctuation', () => {
    expect(sanitizeAgentRunTitle('  []()  ')).toBe('');
  });
});

describe('buildAgentRunReference', () => {
  it('builds a readable, parseable marker', () => {
    expect(buildAgentRunReference('agt_123', 'Refactor auth')).toBe(
      '@[Refactor auth](agent-run:agt_123)',
    );
  });
  it('falls back to a default label when the title sanitizes to empty', () => {
    expect(buildAgentRunReference('agt_1', '[]')).toBe('@[agent run](agent-run:agt_1)');
  });
  it('round-trips through the parser', () => {
    const marker = buildAgentRunReference('agt_xyz', 'My run');
    const [ref] = parseAgentRunReferences(marker);
    expect(ref.id).toBe('agt_xyz');
    expect(ref.raw).toBe(marker);
  });
});

describe('parseAgentRunReferences', () => {
  it('finds every marker with its id and index', () => {
    const text = 'see @[A](agent-run:agt_1) and @[B](agent-run:agt_2) please';
    const refs = parseAgentRunReferences(text);
    expect(refs.map((r) => r.id)).toEqual(['agt_1', 'agt_2']);
    expect(text.slice(refs[0].index, refs[0].index + refs[0].raw.length)).toBe(refs[0].raw);
  });
  it('ignores plain @mentions and email-like text', () => {
    expect(parseAgentRunReferences('hi @bob email a@b.com')).toEqual([]);
  });
  it('hasAgentRunReference mirrors parse', () => {
    expect(hasAgentRunReference('x @[A](agent-run:agt_1)')).toBe(true);
    expect(hasAgentRunReference('no refs here')).toBe(false);
  });
  it('parses markers with long-but-bounded titles', () => {
    const title = 'a'.repeat(512);
    const refs = parseAgentRunReferences(`@[${title}](agent-run:agt_1)`);
    expect(refs.map((r) => r.id)).toEqual(['agt_1']);
  });
  it('does not hang on adversarial @[ repetition (polynomial-ReDoS guard)', () => {
    // Many overlapping `@[` starts with no closing `]` is the ReDoS shape. With
    // the bounded title quantifier this is linear (~constant work per start);
    // an unbounded quantifier would scan to end-of-string per start, making this
    // input quadratic and take tens of seconds. The generous threshold leaves
    // room for loaded CI while still failing loudly on a quadratic regression.
    const start = Date.now();
    expect(parseAgentRunReferences('@['.repeat(30_000))).toEqual([]);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});

describe('expandAgentRunReferences', () => {
  it('replaces each marker with its resolved context', async () => {
    const text = 'before @[A](agent-run:agt_1) after';
    const out = await expandAgentRunReferences(text, async (id) => `<ctx ${id}>`);
    expect(out).toBe('before <ctx agt_1> after');
  });

  it('resolves each unique id once', async () => {
    const calls: string[] = [];
    const text = '@[A](agent-run:agt_1) @[A again](agent-run:agt_1)';
    await expandAgentRunReferences(text, async (id) => {
      calls.push(id);
      return 'ctx';
    });
    expect(calls).toEqual(['agt_1']);
  });

  it('leaves the marker untouched when resolve returns null', async () => {
    const text = '@[A](agent-run:agt_1) @[B](agent-run:agt_2)';
    const out = await expandAgentRunReferences(text, async (id) =>
      id === 'agt_1' ? 'CTX1' : null,
    );
    expect(out).toBe('CTX1 @[B](agent-run:agt_2)');
  });

  it('returns the input unchanged when there are no markers', async () => {
    const out = await expandAgentRunReferences('nothing here', async () => 'x');
    expect(out).toBe('nothing here');
  });
});

describe('wrap / split agent-run context blocks', () => {
  it('round-trips id and title through wrap → split', () => {
    const block = wrapAgentRunContext('agt_1', 'My "quoted" run', '{"a":1}');
    const segments = splitAgentRunContextBlocks(block);
    expect(segments).toEqual([{ type: 'reference', id: 'agt_1', title: 'My "quoted" run' }]);
  });

  it('splits surrounding text from the block', () => {
    const block = wrapAgentRunContext('agt_2', 'Run', 'BODY');
    const segments = splitAgentRunContextBlocks(`hello\n\n${block}\n\nbye`);
    expect(segments).toEqual([
      { type: 'text', value: 'hello\n\n' },
      { type: 'reference', id: 'agt_2', title: 'Run' },
      { type: 'text', value: '\n\nbye' },
    ]);
  });

  it('returns a single text segment when there are no blocks', () => {
    expect(splitAgentRunContextBlocks('just text')).toEqual([{ type: 'text', value: 'just text' }]);
  });

  it('handles multiple blocks', () => {
    const a = wrapAgentRunContext('agt_a', 'A', 'x');
    const b = wrapAgentRunContext('agt_b', 'B', 'y');
    const segments = splitAgentRunContextBlocks(`${a} ${b}`);
    expect(segments.filter((s) => s.type === 'reference').map((s) => s.id)).toEqual([
      'agt_a',
      'agt_b',
    ]);
  });

  it('matches the balanced outer block when the body nests another block', () => {
    // A referenced run's transcript can itself contain a prior expansion.
    const nested = wrapAgentRunContext('agt_inner', 'Inner', '{"x":1}');
    const outer = wrapAgentRunContext('agt_outer', 'Outer', `{"entries":[]} ${nested}`);
    const segments = splitAgentRunContextBlocks(`${outer} tail`);
    expect(segments).toEqual([
      { type: 'reference', id: 'agt_outer', title: 'Outer' },
      { type: 'text', value: ' tail' },
    ]);
  });
});

describe('re-hydrating a saved prompt (draft + launch again)', () => {
  it('splits compact markers back into references', () => {
    const text = `from ${buildAgentRunReference('agt_1', 'My run')} keep going`;
    expect(splitAgentRunMarkers(text)).toEqual([
      { type: 'text', value: 'from ' },
      { type: 'reference', id: 'agt_1', title: 'My run' },
      { type: 'text', value: ' keep going' },
    ]);
  });

  it('parseComposerReferences handles a compact-marker draft', () => {
    const text = `${buildAgentRunReference('agt_1', 'Draft run')} go`;
    expect(parseComposerReferences(text)).toEqual([
      { type: 'reference', id: 'agt_1', title: 'Draft run' },
      { type: 'text', value: ' go' },
    ]);
  });

  it('parseComposerReferences collapses an expanded block (launch again)', () => {
    const text = `do this ${wrapAgentRunContext('agt_2', 'Launched run', '{"big":"json"}')}`;
    expect(parseComposerReferences(text)).toEqual([
      { type: 'text', value: 'do this ' },
      { type: 'reference', id: 'agt_2', title: 'Launched run' },
    ]);
  });

  it('returns a single text segment for plain prompts', () => {
    expect(parseComposerReferences('just a prompt')).toEqual([
      { type: 'text', value: 'just a prompt' },
    ]);
  });
});

describe('normalizeAgentRunReferences', () => {
  it('collapses the compact marker and the expanded block to the same key', () => {
    const compact = `test ${buildAgentRunReference('agt_42', 'A Title')}`;
    const expanded = `test ${wrapAgentRunContext('agt_42', 'A Different Title', '{"entries":[]}')}`;
    // Same id + same surrounding text -> equal, regardless of title or body.
    expect(normalizeAgentRunReferences(compact)).toBe(normalizeAgentRunReferences(expanded));
  });

  it('keys on the run id, so different runs do not collapse together', () => {
    const a = buildAgentRunReference('agt_1', 'X');
    const b = buildAgentRunReference('agt_2', 'X');
    expect(normalizeAgentRunReferences(a)).not.toBe(normalizeAgentRunReferences(b));
  });

  it('leaves plain text untouched', () => {
    expect(normalizeAgentRunReferences('just a prompt')).toBe('just a prompt');
  });
});
