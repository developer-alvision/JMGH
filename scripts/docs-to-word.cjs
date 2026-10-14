'use strict';
/*
 * Builds the two Word documents that go to the client:
 *
 *   handover/JMGH-HMS-Operations-Handbook.docx   from docs/JMGH-HMS-Operations-Handbook.html
 *   handover/JMGH-HMS-Handover-Letter.docx       from docs/handover-letter.html
 *
 * Edit the HTML, run `npm run docs:word`, send the .docx. The .docx files are
 * ordinary editable Word documents, so small changes (the client's name in the
 * letter, for instance) can equally well be made in Word directly.
 *
 * Requires Windows with Microsoft Word installed: Word does the conversion, so
 * tables, headings and page breaks come out as real Word objects rather than a
 * renamed HTML file. There is no cross-platform fallback; on a machine without
 * Word, send the HTML.
 *
 * Word cannot resolve CSS custom properties, dark-mode media queries, grid or
 * sticky positioning, so the handbook is first rewritten with every var()
 * replaced by its light-theme literal and the layout flattened to one print
 * column. The content is not touched. The letter is already plain enough to
 * pass through as it is.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const docs = path.join(root, 'docs');
const outDir = path.join(root, 'handover');

if (os.platform() !== 'win32') {
  console.error('This needs Windows with Microsoft Word installed. Send docs/*.html instead.');
  process.exit(1);
}

// ---------------------------------------------------------------- handbook
const handbookSrc = path.join(docs, 'JMGH-HMS-Operations-Handbook.html');
if (!fs.existsSync(handbookSrc)) {
  console.error('Missing ' + path.relative(root, handbookSrc));
  process.exit(1);
}
let handbook = fs.readFileSync(handbookSrc, 'utf8');

// Read the light-theme token values out of the bare :root block.
const rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(handbook);
if (!rootBlock) throw new Error('Could not find the :root token block.');
const tokens = {};
for (const match of rootBlock[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
  tokens[match[1]] = match[2].trim();
}
if (!tokens.ink || !tokens.accent) throw new Error('Token block not recognised.');

// Drop both dark-theme blocks — Word would otherwise apply whichever it parsed last.
handbook = handbook
  .replace(/@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*?\n  \}\n/g, '')
  .replace(/:root\[data-theme="dark"\]\s*\{[\s\S]*?\n  \}\n/g, '');

// Resolve var(--x) and var(--x, fallback); repeat so tokens may reference tokens.
for (let pass = 0; pass < 4; pass++) {
  handbook = handbook.replace(
    /var\(\s*--([a-z0-9-]+)\s*(?:,\s*([^()]*?))?\)/g,
    (whole, name, fallback) => tokens[name] || (fallback || 'inherit').trim()
  );
}

// Google Fonts will not be fetched during conversion; drop the link so Word
// uses the fallback stacks immediately instead of substituting unpredictably.
handbook = handbook.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '');

const pageCss = `
  /* Word layout: one column, a page break between parts, full-width tables. */
  body{font-family:'Calibri','Source Sans 3',sans-serif;font-size:11pt;line-height:1.45;margin:0}
  .wrap{display:block!important;max-width:none!important;padding:0!important}
  header.mast{border-bottom:2pt solid ${tokens.ink};padding:0 0 10pt;margin-bottom:14pt}
  nav.rail{position:static!important;max-height:none!important;overflow:visible!important;
           border:1pt solid ${tokens.rule};padding:10pt 14pt;margin-bottom:16pt;page-break-after:always}
  nav.rail ol{display:block!important}
  nav.rail a{display:block;border:none!important;padding:2pt 0!important;margin:0!important;
             color:${tokens.accent};text-decoration:none}
  main{display:block!important;gap:0!important;padding:0!important}
  section{page-break-before:always}
  section:first-of-type{page-break-before:avoid}
  .part{border-top:2pt solid ${tokens.ink};padding-top:8pt;margin:0 0 10pt}
  .part h2{font-size:18pt}
  h1{font-size:26pt;line-height:1.1}
  h3{font-size:13pt;margin-top:10pt}
  p,li{max-width:none!important}
  .card{border:1pt solid ${tokens.rule};margin:0 0 12pt;page-break-inside:avoid}
  .card-h{background:${tokens['surface-2']};padding:8pt 11pt;border-bottom:1pt solid ${tokens['rule-soft']}}
  .card-b{padding:11pt;display:block!important}
  .card-b>*+*{margin-top:9pt}
  .tw{overflow:visible!important;border:none!important}
  table{width:100%!important;min-width:0!important;font-size:9.5pt;border:1pt solid ${tokens.rule}}
  th,td{border:0.5pt solid ${tokens.rule};padding:4pt 6pt}
  th{background:${tokens['surface-2']}}
  pre{background:${tokens.code};border:1pt solid ${tokens['rule-soft']};padding:8pt 10pt;font-size:8.5pt;
      font-family:'Consolas',monospace;white-space:pre-wrap;page-break-inside:avoid}
  code{font-family:'Consolas',monospace;font-size:9.5pt;background:${tokens.code}}
  .note{border-left:3pt solid ${tokens.warn};background:${tokens['warn-soft']};padding:8pt 11pt;page-break-inside:avoid}
  .note.stop{border-left-color:${tokens.stop};background:${tokens['stop-soft']}}
  .note.info{border-left-color:${tokens.accent};background:${tokens['accent-soft']}}
  .prompt{border:1.5pt solid ${tokens.accent};page-break-inside:avoid}
  .prompt-h{background:${tokens['accent-soft']};padding:7pt 11pt}
  ol.steps>li::before,ul.check li::before{content:none}
  ol.steps{list-style:decimal;padding-left:18pt}
  ul.check{list-style:square;padding-left:18pt}
  ol.steps>li,ul.check li{padding-left:4pt}
  .facts{display:block}
  .facts span{display:inline-block;margin-right:16pt}
  footer{border-top:1pt solid ${tokens.rule};padding-top:9pt;margin-top:16pt;font-size:9pt}
`;
handbook = handbook.replace('</head>', `<style>${pageCss}</style>\n</head>`);

const staged = path.join(os.tmpdir(), 'jmgh-hms-handbook-word-' + process.pid + '.html');
fs.writeFileSync(staged, handbook, 'utf8');

// ---------------------------------------------------------------- convert
const letterSrc = path.join(docs, 'handover-letter.html');
if (!fs.existsSync(letterSrc)) {
  console.error('Missing ' + path.relative(root, letterSrc));
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const jobs = [
  { src: staged, out: path.join(outDir, 'JMGH-HMS-Operations-Handbook.docx'),
    title: 'JMGH HMS Operations Handbook', margin: 2.0, numbered: true },
  { src: letterSrc, out: path.join(outDir, 'JMGH-HMS-Handover-Letter.docx'),
    title: 'JMGH HMS Handover Letter', margin: 2.5, numbered: false }
];

// Word is driven through PowerShell COM. Parameterised COM properties are
// reached through .Item(...) — calling them like methods throws.
// Word is driven through PowerShell COM. wdFormatDocumentDefault (16) writes a
// real .docx; the older wdFormatDocument (0) is refused against a .docx name.
const ps = `
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$cm = 28.3465

# BuiltInDocumentProperties is a late-bound COM collection that PowerShell
# cannot index either as a method call or through .Item(); both throw a
# NullReferenceException. Reflection is the only route that binds.
function Set-DocProp($doc, $name, $value) {
  $props = $doc.BuiltInDocumentProperties
  $prop = [System.__ComObject].InvokeMember('Item', 'GetProperty', $null, $props, @($name))
  [void][System.__ComObject].InvokeMember('Value', 'SetProperty', $null, $prop, @($value))
}

try {
${jobs.map(job => `
  if (Test-Path -LiteralPath '${job.out}') { Remove-Item -LiteralPath '${job.out}' -Force }
  $doc = $word.Documents.Open('${job.src}', $false, $false)
  $doc.PageSetup.TopMargin    = ${job.margin} * $cm
  $doc.PageSetup.BottomMargin = ${job.margin} * $cm
  $doc.PageSetup.LeftMargin   = ${job.margin} * $cm
  $doc.PageSetup.RightMargin  = ${job.margin} * $cm
  Set-DocProp $doc 'Title'   '${job.title}'
  Set-DocProp $doc 'Author'  'Sanath Sathyamurthy'
  Set-DocProp $doc 'Company' 'Alvision Media'
${job.numbered ? `
  $footer = $doc.Sections.Item(1).Footers.Item(1)
  $footer.Range.Text = ''
  $null = $footer.Range.Fields.Add($footer.Range, 33)
  $footer.Range.ParagraphFormat.Alignment = 1
  $footer.Range.Font.Size = 9
` : ''}
  $doc.SaveAs2('${job.out}', 16)
  $pages = $doc.ComputeStatistics(2)
  $words = $doc.ComputeStatistics(0)
  Write-Output ('${path.basename(job.out)}|' + $pages + '|' + $words)
  $doc.Close(0)
`).join('\n')}
} finally {
  $word.Quit()
}
`;

const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 });

function discardStaged() {
  try { fs.unlinkSync(staged); } catch (error) { /* Word may still hold it */ }
}

if (result.status !== 0) {
  discardStaged();
  console.error('Word conversion failed.');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
  const [name, pages, words] = line.split('|');
  console.log(`  ${name.padEnd(42)} ${String(pages).padStart(3)} pages, ${String(words).padStart(5)} words`);
}

// Confirm each one is genuine Office Open XML and not an HTML file in disguise.
for (const job of jobs) {
  if (!fs.existsSync(job.out)) {
    discardStaged();
    console.error('Not written: ' + job.out);
    process.exit(1);
  }
  const head = fs.readFileSync(job.out).subarray(0, 4);
  if (head[0] !== 0x50 || head[1] !== 0x4b) {
    discardStaged();
    console.error('Not a .docx container: ' + job.out);
    process.exit(1);
  }
}

// A plain-text copy of the letter, for pasting into the email body itself.
// Generated from the same HTML so the two can never drift apart.
function unescapeEntities(text) {
  return text
    .replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Collapse one block of inline markup to a single wrapped text paragraph.
function inlineText(html) {
  // A <br> inside a run of inline markup separates words, so it becomes a
  // space rather than vanishing and joining them together.
  return unescapeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

// Re-wrap at 78 columns with a hanging indent, so numbered items and table
// rows stay readable once the markup is gone.
function wrap(text, firstPrefix, restPrefix) {
  const words = text.split(' ');
  const lines = [];
  let line = firstPrefix;
  let bare = true;
  for (const word of words) {
    if (!bare && (line + ' ' + word).length > 78) {
      lines.push(line);
      line = restPrefix + word;
    } else {
      line = bare ? line + word : line + ' ' + word;
    }
    bare = false;
  }
  lines.push(line);
  return lines.join('\n');
}

let letterBody = fs.readFileSync(letterSrc, 'utf8')
  .replace(/[\s\S]*?<body>/i, '')
  .replace(/<\/body>[\s\S]*/i, '');

// Attachment table: each row becomes a titled, indented entry.
letterBody = letterBody.replace(
  /<tr>[\s\S]*?<td class="f">([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi,
  (whole, head, description) =>
    `\n@@BLOCK@@  ${inlineText(head)}\n${wrap(inlineText(description), '  ', '  ')}\n@@BLOCK@@\n`
);

// Ordered lists keep their numbers; unordered lists become dashes.
letterBody = letterBody.replace(/<(ol|ul)>([\s\S]*?)<\/\1>/gi, (whole, kind, inner) => {
  let index = 0;
  const items = [...inner.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map(match => {
    index += 1;
    const marker = kind.toLowerCase() === 'ol' ? `  ${index}. ` : '  - ';
    return wrap(inlineText(match[1]), marker, ' '.repeat(marker.length));
  });
  return `\n@@BLOCK@@${items.join('\n')}\n@@BLOCK@@\n`;
});

// Remaining paragraphs and headings.
letterBody = letterBody
  .replace(/<h2>([\s\S]*?)<\/h2>/gi, (whole, inner) => `\n@@BLOCK@@${inlineText(inner)}\n@@BLOCK@@\n`)
  .replace(/<p class="subject">([\s\S]*?)<\/p>/gi, (whole, inner) => `\n@@BLOCK@@${inlineText(inner)}\n@@BLOCK@@\n`)
  // A <p> whose only breaks are <br> is an address block: keep its own lines.
  .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (whole, inner) => {
    if (/<br\s*\/?>/i.test(inner)) {
      const lines = inner.split(/<br\s*\/?>/i).map(inlineText).filter(Boolean);
      return `\n@@BLOCK@@${lines.join('\n')}\n@@BLOCK@@\n`;
    }
    return `\n@@BLOCK@@${wrap(inlineText(inner), '', '')}\n@@BLOCK@@\n`;
  })
  .replace(/<[^>]+>/g, '');

const letterText = unescapeEntities(letterBody)
  .split('@@BLOCK@@').join('')
  .split('\n').map(line => line.replace(/[ \t]+$/, ''))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim() + '\n';

const letterTextPath = path.join(docs, 'handover-letter.txt');
fs.writeFileSync(letterTextPath, letterText, 'utf8');

discardStaged();
console.log(`  ${'handover-letter.txt'.padEnd(42)}  plain text, for the email body`);
console.log(`\nWritten to ${path.relative(root, outDir)}/ — send these beside the archive.`);
