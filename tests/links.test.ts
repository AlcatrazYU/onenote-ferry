import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLinkIndex, relativePath, relinkPages, resolveLink, rewriteLinks, sectionSegments, unquote } from '../src/core/links.ts';
import type { LinkIndex, LinkStats } from '../src/core/links.ts';
import { memorySink } from './helpers.ts';

const PAGE_A = '{11111111-1111-1111-1111-111111111111}';
const PAGE_B = '{22222222-2222-2222-2222-222222222222}';
const SECTION = '{33333333-3333-3333-3333-333333333333}';

function index(): LinkIndex {
	return {
		pages: new Map([[PAGE_A, 'Notebook A/Section 1/Page A.md'], [PAGE_B, 'Notebook B/Group/Section 2/Page B.md']]),
		sections: [
			{ source: ['Notebook A', 'Section 1'], toc: 'Notebook A/Section 1/_目录.md' },
			{ source: ['Notebook B', 'Group', 'Section 2'], toc: 'Notebook B/Group/Section 2/_目录.md' },
		],
		files: new Set(['Notebook A/Section 1/Page A.md', 'Notebook A/Section 1/Other page.md', 'Notebook B/Group/Section 2/Page B.md']),
	};
}
const stats = (): LinkStats => ({ links: 0, resolved: 0, unresolved: 0, filesChanged: 0, unresolvedTargets: {} });
const FROM = 'Notebook A/Section 1/Page A.md';

test('links to pages resolve by page id, across notebooks and section groups', () => {
	const url = `onenote:https://d.docs.live.net/0123456789abcdef/Folder/Notebook%20B/Group/Section%202.one#Page%20B&section-id=${SECTION}&page-id=${PAGE_B}&end`;
	assert.equal(resolveLink(unquote(url), FROM, index()), 'Notebook B/Group/Section 2/Page B.md');
	const s = stats();
	assert.equal(rewriteLinks(`see [B](${url}) here`, FROM, index(), s), 'see [B](<../../Notebook B/Group/Section 2/Page B.md>) here');
	assert.deepEqual([s.links, s.resolved, s.unresolved], [1, 1, 0]);
});

test('a page id that matches no converted page leaves the link as it was', () => {
	const url = 'onenote:https://d.docs.live.net/0123456789abcdef/Documents/Notebook%20A/Gone.one#Old&section-id={44444444-4444-4444-4444-444444444444}&page-id={55555555-5555-5555-5555-555555555555}&end';
	const s = stats();
	assert.equal(rewriteLinks(`[old](${url})`, FROM, index(), s), `[old](${url})`);
	assert.deepEqual([s.resolved, s.unresolved], [0, 1]);
	assert.deepEqual(Object.keys(s.unresolvedTargets), ['onenote:https://d.docs.live.net/0123456789abcdef/Documents/Notebook A/Gone.one#Old']);
});

test('links to a whole section work whatever folder, account or server the notebook is on', () => {
	const tail = `Notebook%20B/Group/Section%202.one#section-id=${SECTION}&end`;
	for (const prefix of [
		'https://d.docs.live.net/0123456789abcdef/文档/',
		'https://d.docs.live.net/0123456789abcdef/Documents/',
		'https://d.docs.live.net/0123456789abcdef/Some%20folder/Deeper/',
		'https://d.docs.live.net/fedcba9876543210/Shared%20by%20a%20friend/',
		'https://contoso.sharepoint.com/sites/Team/Shared%20Documents/',
		'https://contoso-my.sharepoint.com/personal/someone_contoso_com/Documents/',
	]) {
		assert.equal(resolveLink(unquote(`onenote:${prefix}${tail}`), FROM, index()), 'Notebook B/Group/Section 2/_目录.md', prefix);
	}
});

test('a relative section link is read against its base path', () => {
	const url = `onenote:Section%202.one#section-id=${SECTION}&end&base-path=https://d.docs.live.net/0123456789abcdef/Folder/Notebook%20B/Group`;
	assert.deepEqual(sectionSegments(unquote(url)), ['0123456789abcdef', 'Folder', 'Notebook B', 'Group', 'Section 2']);
	assert.equal(resolveLink(unquote(url), FROM, index()), 'Notebook B/Group/Section 2/_目录.md');
});

test('two converted sections with the same path are ambiguous and left alone', () => {
	const ix = index();
	ix.sections.push({ source: ['Notebook A', 'Section 1'], toc: 'Notebook A (2)/Section 1/_目录.md' });
	assert.equal(resolveLink(unquote(`onenote:https://x.example/Notebook%20A/Section%201.one#section-id=${SECTION}&end`), FROM, ix), undefined);
});

test('a link to a page of the same section by title resolves when that page exists', () => {
	assert.equal(resolveLink('onenote:#Other page&section-id={x}&end', FROM, index()), 'Notebook A/Section 1/Other page.md');
	assert.equal(resolveLink('onenote:#Missing page&section-id={x}&end', FROM, index()), undefined);
	assert.equal(rewriteLinks('[o](<onenote:#Other%20page&end>)', FROM, index(), stats()), '[o](<Other page.md>)');
});

test('percent-decoding is tolerant of malformed sequences', () => {
	assert.equal(unquote('a%20b%E4%B8%AD'), 'a b中');
	assert.equal(unquote('bad%FFend'), 'bad\uFFFDend');
	assert.equal(unquote('100%'), '100%');
});

test('relative paths between folders', () => {
	assert.equal(relativePath('A/S/p.md', 'A/S'), 'p.md');
	assert.equal(relativePath('A/T/p.md', 'A/S'), '../T/p.md');
	assert.equal(relativePath('B/G/S/p.md', 'A/S'), '../../B/G/S/p.md');
	assert.equal(relativePath('A/S/p.md', ''), 'A/S/p.md');
});

test('the index reads page ids from front matter, skips attachments and tables of contents, and finds earlier sections', async () => {
	const sink = memorySink();
	await sink.writeText('NB/S/Page.md', `---\ntitle: "Page"\nonenote-id: "${PAGE_A.toLowerCase()}"\n---\n\nbody\n`);
	await sink.writeText('NB/S/_目录.md', '---\ntitle: "S 目录"\n---\n');
	await sink.writeText('NB/Old/_目录.md', '---\ntitle: "Old 目录"\n---\n');
	await sink.writeText('NB/S/_附件/notes.md', `onenote-id: "${PAGE_B}"\n`);
	const ix = await buildLinkIndex(sink, ['NB'], [{ source: ['NB', 'S'], toc: 'NB/S/_目录.md' }], { tocFileNames: ['_目录'], attachmentsFolders: ['_附件'] });
	assert.deepEqual([...ix.pages], [[PAGE_A, 'NB/S/Page.md']]);
	assert.deepEqual(ix.sections.map(s => s.toc).sort(), ['NB/Old/_目录.md', 'NB/S/_目录.md']);
	assert.deepEqual([...ix.files], ['NB/S/Page.md']);
});

test('the index reads tables of contents and attachments folders of every language given', async () => {
	const sink = memorySink();
	await sink.writeText('NB/S/_目录.md', '---\ntitle: "S"\n---\n');
	await sink.writeText('Notes/T/_contents.md', '---\ntitle: "T"\n---\n');
	await sink.writeText('Notes/T/_attachments/notes.md', `onenote-id: "${PAGE_B}"\n`);
	await sink.writeText('Notes/T/Page.md', `---\nonenote-id: "${PAGE_A}"\n---\n`);
	const ix = await buildLinkIndex(sink, ['NB', 'Notes'], [], { tocFileNames: ['_目录', '_contents'], attachmentsFolders: ['_附件', '_attachments'] });
	assert.deepEqual(ix.sections.map(s => s.toc).sort(), ['NB/S/_目录.md', 'Notes/T/_contents.md']);
	assert.deepEqual([...ix.pages], [[PAGE_A, 'Notes/T/Page.md']]);
});

test('relinking rewrites only pages that change and keeps their modification time', async () => {
	const sink = memorySink();
	const url = `onenote:https://d.docs.live.net/0/F/NB/T.one#Target&section-id=${SECTION}&page-id=${PAGE_B}&end`;
	await sink.writeText('NB/S/From.md', `---\nmodified: 2024-01-02T03:04:05.000Z\nonenote-id: "${PAGE_A}"\n---\n\n[t](${url})\n`);
	await sink.writeText('NB/T/Target.md', `---\nonenote-id: "${PAGE_B}"\n---\n\nno links\n`);
	const ix = await buildLinkIndex(sink, ['NB'], [], { tocFileNames: ['_目录'], attachmentsFolders: ['_附件'] });
	const result = await relinkPages(sink, ['NB/S/From.md', 'NB/T/Target.md'], ix);
	assert.deepEqual([result.links, result.resolved, result.filesChanged], [1, 1, 1]);
	assert.match(sink.files.get('NB/S/From.md') as string, /\[t\]\(<\.\.\/T\/Target\.md>\)/);
	assert.equal(sink.times.get('NB/S/From.md')?.toISOString(), '2024-01-02T03:04:05.000Z');
	assert.equal(sink.times.has('NB/T/Target.md'), false);
});
