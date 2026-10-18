import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addEmptyFirstPageRefs, firstPageNumber, fixPartXml, markPageFields, PAGE_MARK, PAGES_MARK, withFallback } from './docx-fixups';

test('table indents and fixed layouts are written the way docx-preview reads them', () => {
  const xml = '<w:tblPr><w:tblW w:w="11625" w:type="dxa"/><w:tblInd w:w="-1560" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>';
  const out = fixPartXml(xml);
  assert.match(out, /<w:tblInd w:w="-1560" w:type="dxa" w:start="-1560"\/>/);
  assert.match(out, /<w:tblLayout w:type="fixed" w:val="fixed"\/>/);
  // Already readable, or percentages: left alone.
  assert.equal(fixPartXml('<w:tblInd w:w="20" w:type="dxa" w:start="20"/>'), '<w:tblInd w:w="20" w:type="dxa" w:start="20"/>');
  assert.equal(fixPartXml('<w:tblInd w:w="500" w:type="pct"/>'), '<w:tblInd w:w="500" w:type="pct"/>');
});

test('a run naming only an East-Asian font keeps the inherited Latin font', () => {
  assert.equal(fixPartXml('<w:rFonts w:eastAsia="Times New Roman" w:cs="Times New Roman"/>'), '<w:rFonts w:cs="Times New Roman"/>');
  const explicit = '<w:rFonts w:ascii="Roboto" w:hAnsi="Roboto" w:eastAsia="Times New Roman"/>';
  assert.equal(fixPartXml(explicit), explicit);
  const themed = '<w:rFonts w:asciiTheme="minorHAnsi" w:eastAsia="SimSun"/>';
  assert.equal(fixPartXml(themed), themed);
});

test('"different first page" without its own header/footer gets empty ones, as Word shows it', () => {
  const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rId13"/><w:footerReference w:type="default" r:id="rId14"/><w:pgSz w:w="12240"/><w:titlePg/></w:sectPr>';
  const { xml, header, footer } = addEmptyFirstPageRefs(`<w:body><w:p/>${sect}</w:body>`);
  assert.ok(header && footer);
  assert.match(xml, /<w:sectPr><w:headerReference w:type="first" r:id="trigonEmptyHeader"\/><w:headerReference w:type="default" r:id="rId13"\/><w:footerReference w:type="first" r:id="trigonEmptyFooter"\/>/);
  // Without titlePg, or with first-page parts already defined: unchanged.
  assert.equal(addEmptyFirstPageRefs('<w:sectPr><w:pgSz/></w:sectPr>').header, false);
  const own = '<w:sectPr><w:headerReference w:type="first" r:id="a"/><w:footerReference w:type="first" r:id="b"/><w:titlePg/></w:sectPr>';
  assert.deepEqual(addEmptyFirstPageRefs(own), { xml: own, header: false, footer: false });
});

test('page number fields in headers and footers get markers instead of the saved number', () => {
  const footer =
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE   \\* MERGEFORMAT </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    ' of <w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>12</w:t></w:r></w:fldSimple></w:p>';
  const out = markPageFields(footer);
  assert.ok(out.includes(`<w:t>${PAGE_MARK}</w:t>`));
  assert.ok(out.includes(`<w:t>${PAGES_MARK}</w:t>`));
  assert.ok(!out.includes('<w:t>3</w:t>') && !out.includes('<w:t>12</w:t>'));
  // Cross-references to pages are not page numbers.
  const ref = '<w:instrText> PAGEREF _Toc1 \\h </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>5</w:t><w:fldChar w:fldCharType="end"/>';
  assert.equal(markPageFields(ref), ref);
});

test('page numbering start comes from the section settings', () => {
  assert.equal(firstPageNumber('<w:sectPr><w:pgNumType w:start="0"/></w:sectPr>'), 0);
  assert.equal(firstPageNumber('<w:sectPr><w:pgNumType w:fmt="decimal"/></w:sectPr>'), 1);
  assert.equal(firstPageNumber('<w:sectPr/>'), 1);
});

test('missing fonts fall back to a matching generic family', () => {
  assert.equal(withFallback('Roboto'), 'Roboto, sans-serif');
  assert.equal(withFallback('"Times New Roman"'), '"Times New Roman", serif');
  assert.equal(withFallback('Consolas'), 'Consolas, monospace');
  assert.equal(withFallback('Calibri, sans-serif'), 'Calibri, sans-serif');
  assert.equal(withFallback(''), '');
});
