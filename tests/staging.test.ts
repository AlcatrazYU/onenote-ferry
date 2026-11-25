// The staging folders an update converts sections into (src/node/staging.ts): one that cannot be
// removed (held open by another program, as Windows does) never stops an update, and old leftovers
// are swept.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stagingPlaces, stagingRoot, sweepStaging } from '../src/node/staging.ts';

test('a staging folder that cannot be removed is left where it is: freeing it never throws', { skip: process.platform === 'win32' }, async () => {
	const tmp = mkdtempSync(join(tmpdir(), 'ferry-staging-test-'));
	try {
		const places = stagingPlaces(tmp);
		const { id } = await places.newStaging();
		writeFileSync(join(stagingRoot(tmp), id, 'page.md'), 'text');
		// The staging folder's parent refuses changes: removing the section's folder fails.
		chmodSync(stagingRoot(tmp), 0o500);
		await places.releaseStaging(id);
		chmodSync(stagingRoot(tmp), 0o700);
		assert.equal(existsSync(join(stagingRoot(tmp), id)), true);
		await places.releaseStaging(id);
		assert.equal(existsSync(join(stagingRoot(tmp), id)), false);
	}
	finally {
		chmodSync(stagingRoot(tmp), 0o700);
		rmSync(tmp, { recursive: true, force: true });
	}
});

test('staging folders left more than a week ago are swept; newer ones and other files are not', async () => {
	const tmp = mkdtempSync(join(tmpdir(), 'ferry-staging-test-'));
	try {
		const places = stagingPlaces(tmp);
		const old = (await places.newStaging()).id, fresh = (await places.newStaging()).id;
		const root = stagingRoot(tmp);
		const weekAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
		utimesSync(join(root, old), weekAgo, weekAgo);
		mkdirSync(join(root, 'not ours'));
		utimesSync(join(root, 'not ours'), weekAgo, weekAgo);
		sweepStaging(tmp);
		assert.deepEqual(readdirSync(root).sort(), [fresh, 'not ours'].sort());
	}
	finally {
		rmSync(tmp, { recursive: true, force: true });
	}
});
