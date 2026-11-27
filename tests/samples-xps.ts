// An invented Windows printout document (XPS), as Microsoft's XPS writer lays one out: a part split
// into pieces, pages of image strips and filled shapes, shapes kept in a resource dictionary.

import { bytes, makeZip } from './zip-writer.ts';

/** The first 24 bytes of a PNG of the given size: enough for its type and size. */
export function pngHeader(width: number, height: number): Uint8Array {
	const b = new Uint8Array(24);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	new DataView(b.buffer).setUint32(16, width);
	new DataView(b.buffer).setUint32(20, height);
	return b;
}

const PAGE_1 = `<FixedPage Width="96" Height="192" xmlns="http://schemas.microsoft.com/xps/2005/06" xml:lang="und">
	<!-- Microsoft XPS Document Converter (MXDC) Generated! -->
	<FixedPage.Resources><ResourceDictionary Source="/Resources/_D1.dict" /></FixedPage.Resources>
	<Canvas RenderTransform="1,0,0,1,8,4">
		<Path Data="M 0,0 L 80,0 80,40 0,40 z" Clip="M 0,0 L 80,0 80,40 0,40 z">
			<Path.Fill>
				<ImageBrush ImageSource="/Documents/1/Resources/Images/1.PNG" Viewbox="0,0,160,80" TileMode="None" ViewboxUnits="Absolute" ViewportUnits="Absolute" Viewport="0,0,80,40" />
			</Path.Fill>
		</Path>
		<Path Data="F1 M 0,0 L 10,0
			10,10 z" RenderTransform="1,0,0,1,20,60" Fill="#ffff0000" />
		<Path Data="{StaticResource R0}" RenderTransform="1,0,0,1,40,80" Fill="#80000000" />
	</Canvas>
</FixedPage>`;

const PAGE_2 = `<FixedPage Width="96" Height="192" xmlns="http://schemas.microsoft.com/xps/2005/06">
	<Glyphs OriginX="10" OriginY="20" FontRenderingEmSize="12" FontUri="/Resources/font.odttf" UnicodeString="text" Fill="#ff000000" />
</FixedPage>`;

/** Two pages: the first drawn from a strip and shapes, the second text (not drawn here). */
export function xpsDocument(): Uint8Array {
	const page1 = bytes(PAGE_1);
	const cut = Math.floor(page1.length / 2);
	return makeZip([
		{ name: '_rels/.rels', data: bytes('<Relationships><Relationship Type="http://schemas.microsoft.com/xps/2005/06/fixedrepresentation" Target="/FixedDocumentSequence.fdseq" Id="R0" /></Relationships>'), deflate: true },
		{ name: 'FixedDocumentSequence.fdseq', data: bytes('<FixedDocumentSequence><DocumentReference Source="/Documents/1/FixedDocument.fdoc" /></FixedDocumentSequence>'), deflate: true },
		{ name: 'Documents/1/FixedDocument.fdoc', data: bytes('<FixedDocument><PageContent Source="Pages/1.fpage" /><PageContent Source="/Documents/1/Pages/2.fpage" /></FixedDocument>'), deflate: true },
		{ name: 'Documents/1/Pages/1.fpage/[0].piece', data: page1.subarray(0, cut), deflate: true },
		{ name: 'Documents/1/Resources/Images/1.PNG', data: pngHeader(160, 80) },
		{ name: 'Documents/1/Pages/1.fpage/[1].last.piece', data: page1.subarray(cut), deflate: true },
		{ name: 'Documents/1/Pages/2.fpage', data: bytes(PAGE_2), deflate: true },
		{ name: 'Resources/_D1.dict', data: bytes('<ResourceDictionary xmlns:x="k"><PathGeometry x:Key="R0" FillRule="NonZero" Figures="M 0,0 C 1,1 2,2 3,3 z"/></ResourceDictionary>'), deflate: true },
	]);
}
