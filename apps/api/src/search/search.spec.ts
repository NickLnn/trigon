import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { fileKind, officeText, readZip, tidy } from './extract';
import { fold, searchWords, snippet } from './fold';

/** Minimal zip writer (deflate) for building Office files in tests. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, 'utf8');
    const data = deflateRawSync(raw);
    const n = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    central.push(cd, n);
    offset += 30 + n.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

describe('fold', () => {
  it('ignores case, accents and final sigma', () => {
    assert.equal(fold('ΑΘΗΝΑΣ'), 'αθηνασ');
    assert.equal(fold('Αθήνας'), 'αθηνασ');
    assert.equal(fold('Café Ϊ'), 'cafe ι');
  });

  it('splits a query into folded words', () => {
    assert.deepEqual(searchWords('  Οδηγός, sign-out! '), ['οδηγοσ', 'sign', 'out']);
  });
});

describe('snippet', () => {
  it('marks accented words matched by unaccented input', () => {
    assert.equal(snippet('Η εγκατάσταση στην Αθήνα.', ['αθην'], false, false), 'Η εγκατάσταση στην <mark>Αθήνα</mark>');
  });

  it('drops words cut at the window edges and adds ellipses', () => {
    const s = snippet('ord one two backup three fou', ['backup'], true, true);
    assert.equal(s, '… one two <mark>backup</mark> three …');
  });

  it('starts a few words before the first match', () => {
    const words = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
    assert.match(snippet(words, ['w30'], false, false), /^… w24 .*<mark>w30<\/mark>/);
  });
});

describe('extract', () => {
  it('picks a reader from the file name', () => {
    assert.equal(fileKind('Scan.PDF', null, false), 'pdf');
    assert.equal(fileKind('photo.jpeg', 'image/jpeg', false), 'image');
    assert.equal(fileKind('notes.txt', 'text/plain', true), 'text');
    assert.equal(fileKind('report.docx', 'application/octet-stream', false), 'docx');
    assert.equal(fileKind('archive.zip', 'application/zip', false), null);
  });

  it('reads a .docx with headers, breaks and entities', () => {
    const buf = zip({
      'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Οδηγός</w:t></w:r><w:r><w:t xml:space="preserve"> εγκατάστασης</w:t></w:r></w:p><w:p><w:r><w:t>A &amp; B</w:t><w:tab/><w:t>C</w:t></w:r></w:p></w:body></w:document>',
      'word/header1.xml': '<w:hdr><w:p><w:r><w:t>Confidential</w:t></w:r></w:p></w:hdr>',
    });
    assert.equal(tidy(officeText(buf, 'docx')), 'Οδηγός εγκατάστασης\nA & B C\n\nConfidential');
  });

  it('reads slides in order and spreadsheet strings', () => {
    const pptx = zip({
      'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>Ten</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>',
    });
    assert.equal(tidy(officeText(pptx, 'pptx')), 'Two\n\nTen');
    const xlsx = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Servers" sheetId="1"/></sheets></workbook>',
      'xl/sharedStrings.xml': '<sst><si><t>esxi-01</t></si><si><r><t>10.0.0.</t></r><r><t>5</t></r></si></sst>',
    });
    assert.equal(tidy(officeText(xlsx, 'xlsx')), 'Servers\nesxi-01\n10.0.0.5');
  });

  it('reads OpenDocument text', () => {
    const odt = zip({ 'content.xml': '<office:text><text:h>Title</text:h><text:p>Hello <text:span>world</text:span><text:tab/>!</text:p></office:text>' });
    assert.equal(tidy(officeText(odt, 'odf')), 'Title\nHello world !');
  });

  it('reads Visio shape text, shape data and page names', () => {
    const vsdx = zip({
      'visio/pages/pages.xml':
        "<?xml version='1.0' encoding='utf-8' ?><Pages xmlns='http://schemas.microsoft.com/office/visio/2012/main'><Page ID='0' NameU='Page-1' IsCustomNameU='1' Name='Δίκτυο Αθήνα'><PageSheet/><Rel r:id='rId1'/></Page><Page ID='4' NameU='Rack' Name='Rack'><Rel r:id='rId2'/></Page></Pages>",
      'visio/pages/page1.xml':
        "<PageContents><Shapes><Shape ID='1'><Section N='Property'><Row N='IP'><Cell N='Value' V='10.20.0.5' U='STR'/><Cell N='Label' V='IP address'/></Row><Row N='Hidden'><Cell N='Value' V='0'/></Row></Section><Text><cp IX='0'/>Core switch<pp IX='0'/>\nSW-ATH-01</Text></Shape><Shape ID='2'><Text>Firewall &amp; VPN</Text></Shape></Shapes></PageContents>",
      'visio/pages/page2.xml': "<PageContents><Shapes><Shape ID='3'><Text><fld IX='0'>Rack A</fld></Text></Shape></Shapes></PageContents>",
    });
    assert.equal(fileKind('Network.VSDX', null, false), 'vsdx');
    assert.equal(tidy(officeText(vsdx, 'vsdx')), 'Δίκτυο Αθήνα\nCore switch\nSW-ATH-01\nFirewall & VPN\n10.20.0.5\n\nRack\nRack A');
  });

  it('keeps PDF page breaks, including blank leading pages', () => {
    assert.equal(tidy('\f\n first  page \n\f\fthird\n\n\n\nend \n'), '\ffirst page\f\fthird\n\nend');
  });

  it('rejects non-zip data', () => {
    assert.throws(() => readZip(Buffer.from('not a zip at all, definitely not')), /Not a zip/);
  });
});
