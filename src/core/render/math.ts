// Translates the parser's notation for OneNote equations into LaTeX that Obsidian (MathJax) renders.
//
// The parser writes each equation object as `\name{argument}{argument}...`, where the name comes
// from the object's type (the RichEdit math object types, see "Math in Office"): `\pow` for a
// superscript, `\frac` for a fraction, `\parens` for brackets, `\fnCall` for a function, `\mathrm`
// for a box, `\withSubscript` for a lower limit, `\∑` and `\∫` for n-ary operators, and
// `\unknown{N}` for the other types, N being the type number.

type Node = string | { name: string, args: Node[][] };

/** Splits the parser's notation into text and objects with their arguments. */
function parse(text: string): Node[] {
	let position = 0;
	const sequence = (inArgument: boolean): Node[] => {
		const nodes: Node[] = [];
		let plain = '';
		const flush = () => {
			if (plain !== '') nodes.push(plain);
			plain = '';
		};
		while (position < text.length) {
			const c = text[position];
			if (inArgument && c === '}') break;
			if (c === '\\') {
				const name = /^\\(unknown\{\d+\}|[A-Za-z]+|[^\sA-Za-z{}\\])\{/.exec(text.slice(position));
				if (name) {
					flush();
					position += name[0].length;
					const args: Node[][] = [];
					for (;;) {
						args.push(sequence(true));
						position++; // the closing brace
						if (text[position] !== '{') break;
						position++;
					}
					nodes.push({ name: name[1], args });
					continue;
				}
			}
			plain += c;
			position++;
		}
		flush();
		return nodes;
	};
	return sequence(false);
}

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'arg', 'deg', 'dim', 'gcd', 'ker', 'Pr', 'arcsin', 'arccos', 'arctan']);

/** A group for a script or a limit: bare when it is one character. */
const group = (latex: string) => ([...latex].length === 1 ? latex : `{${latex}}`);

function render(nodes: Node[]): string {
	return nodes.map(node => (typeof node === 'string' ? node : renderObject(node))).join('');
}

function renderObject({ name, args }: { name: string, args: Node[][] }): string {
	const a = args.map(render);
	const [first = '', second = '', third = ''] = a;
	switch (name) {
		case 'pow': return `${group(first)}^${group(second)}`;
		case 'frac': return `\\frac{${first}}{${second}}`;
		case 'parens': return `\\left(${a.join('')}\\right)`;
		case 'fnCall': {
			const fn = first.trim();
			return `${FUNCTIONS.has(fn) ? `\\${fn}` : `\\operatorname{${fn}}`}{${second}}`;
		}
		case 'withSubscript': {
			const base = first.trim();
			return FUNCTIONS.has(base) ? `\\${base}_${group(second)}` : `\\underset{${second}}{${first}}`;
		}
		case 'mathrm': return `{${first}}`;
		case '∑': case '∫': {
			const operator = name === '∑' ? '\\sum' : '\\int';
			return `${operator}${first ? `_${group(first)}` : ''}${second ? `^${group(second)}` : ''}{${third}}`;
		}
	}
	const type = /^unknown\{(\d+)\}$/.exec(name)?.[1];
	switch (type) {
		case '10': return `\\hat{${first}}`; // accent (the accent's own character is not kept)
		case '12': return `\\boxed{${first}}`; // boxed formula
		case '14': return `\\left(${a.join(' \\mid ')}\\right)`; // brackets with separators
		case '15': return `\\begin{aligned}${a.join(' \\\\ ')}\\end{aligned}`; // equation array
		case '18': return `{}_${group(first)}^${group(second)}${third}`; // scripts on the left
		case '23': return `\\overline{${first}}`;
		case '24': return `\\phantom{${first}}`;
		case '25': return second.trim() === '' && args.length < 2 ? `\\sqrt{${first}}` // radical: degree, then base
			: first.trim() === '' ? `\\sqrt{${second}}` : `\\sqrt[${first}]{${second}}`;
		case '27': return `\\genfrac{}{}{0pt}{}{${first}}{${second}}`; // stack
		case '29': return `${group(first)}_${group(second)}`; // subscript
		case '30': return `${group(first)}_${group(second)}^${group(third)}`; // subscript and superscript
		case '32': return `\\underline{${first}}`;
		case '33': return `\\overset{${second}}{${first}}`; // upper limit
	}
	// Anything else keeps its content.
	return a.join(' ');
}

/** LaTeX for one equation written in the parser's notation. */
export function officeMathToLatex(text: string): string {
	return render(parse(text));
}
