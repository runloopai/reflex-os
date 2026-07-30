/**
 * The corruption-recovery loop: snapshot a live database, wreck the data
 * dir the way an unclean kill does, and watch `ArcadeDb.open` restore from
 * the newest backup instead of dying.
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ArcadeDb } from '../server/db.ts';

let root: string;

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('backup and auto-restore', () => {
  it('restores a wrecked data dir from the newest snapshot', { timeout: 30_000 }, async () => {
    root = await mkdtemp(join(tmpdir(), 'arcade-backup-'));
    const dataDir = join(root, 'data');

    const db = await ArcadeDb.open(dataDir);
    const user = await db.createUser('Survivor');
    const backupPath = await db.dumpTo(dataDir);
    await db.close();
    expect(backupPath).toContain('.backups');
    expect(await readdir(ArcadeDb.backupDirFor(dataDir))).toHaveLength(1);

    // Wreck the control file the way a SIGKILL mid-write does.
    await writeFile(join(dataDir, 'global', 'pg_control'), 'garbage');

    const reopened = await ArcadeDb.open(dataDir);
    const survivor = await reopened.userById(user.id);
    expect(survivor?.name).toBe('Survivor');
    await reopened.close();

    // The corrupt dir was set aside, not destroyed.
    const siblings = await readdir(root);
    expect(siblings.some((f) => f.startsWith('data.corrupt-'))).toBe(true);
  });

  it('keeps only the newest snapshots', { timeout: 30_000 }, async () => {
    const dataDir = join(root, 'data2');
    const db = await ArcadeDb.open(dataDir);
    for (let i = 0; i < 5; i++) {
      await db.dumpTo(dataDir, 3);
      await new Promise((r) => setTimeout(r, 20));
    }
    await db.close();
    expect(await readdir(ArcadeDb.backupDirFor(dataDir))).toHaveLength(3);
  });
});
