import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officeMathToLatex } from '../src/core/render/math.ts';
import { Adapter } from '../src/core/adapter.ts';
import { renderRuns } from '../src/core/render/inline.ts';
import { zhHans } from '../src/core/strings.ts';
import { element, outline, pageJson, rich, run, sectionJson } from './helpers.ts';

test('the parser notation for equations becomes LaTeX', () => {
	assert.equal(officeMathToLatex('\\pow{a}{2}+\\pow{b}{2}=\\pow{c}{2}'), 'a^2+b^2=c^2');
	assert.equal(officeMathToLatex('x=\\frac{−b±\\unknown{25}{}{\\pow{b}{2}−4ac}}{2a}'), 'x=\\frac{−b±\\sqrt{b^2−4ac}}{2a}');
	assert.equal(officeMathToLatex('\\unknown{25}{3}{x}'), '\\sqrt[3]{x}');
	assert.equal(officeMathToLatex('\\∑{i=1}{n}{\\pow{i}{2}}'), '\\sum_{i=1}^n{i^2}');
	assert.equal(officeMathToLatex('\\∫{0}{1}{x dx}'), '\\int_0^1{x dx}');
	assert.equal(officeMathToLatex('\\parens{a+b}'), '\\left(a+b\\right)');
	assert.equal(officeMathToLatex('\\fnCall{sin}{θ}+\\fnCall{f}{x}'), '\\sin{θ}+\\operatorname{f}{x}');
	assert.equal(officeMathToLatex('\\withSubscript{lim}{n→∞}'), '\\lim_{n→∞}');
	assert.equal(officeMathToLatex('\\unknown{29}{x}{12}+\\unknown{30}{y}{0}{2}+\\unknown{23}{AB}'), 'x_{12}+y_0^2+\\overline{AB}');
	assert.equal(officeMathToLatex('a+b'), 'a+b');
});

test('an equation split over several runs, with an empty piece, is one formula', async () => {
	// The pieces as the parser writes them for "x = (−b ± √(b\u00B2−4ac)) / 2a".
	const pieces = ['x=', '\\frac{', '−b±', '\\unknown{25}{', '', '}{', '\\pow{', 'b}{', '2}', '−4ac}', '}{', '2a}'];
	const section = new Adapter(zhHans).section(sectionJson('S', [pageJson('P', [outline([element([rich([run('formula: '), ...pieces.map(latex => run('\uFDD0', { latex }))])])])])]));
	const paragraph = section.pages[0].outlines[0].children[0] as { runs: { text: string, math?: boolean }[] };
	assert.equal(renderRuns(paragraph.runs as never, {}), 'formula: $x=\\frac{−b±\\sqrt{b^2−4ac}}{2a}$');
});
