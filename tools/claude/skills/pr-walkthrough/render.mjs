#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const [, , diffPath, notesPath, outPath] = process.argv;
if (!diffPath || !notesPath || !outPath) {
  console.error('usage: render.mjs <diff-file> <notes.json> <out.html>');
  process.exit(1);
}

const notes = JSON.parse(readFileSync(notesPath, 'utf8'));
const files = parseDiff(readFileSync(diffPath, 'utf8'));

function parseDiff(text) {
  const out = [];
  let file = null;
  let hunk = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const m = raw.match(/ b\/(.+)$/);
      file = { path: m ? m[1] : raw.slice(11), hunks: [], added: 0, removed: 0, status: 'changed' };
      out.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (raw.startsWith('new file mode')) { file.status = 'new'; continue; }
    if (raw.startsWith('deleted file mode')) { file.status = 'deleted'; continue; }
    if (raw.startsWith('rename from ') || raw.startsWith('rename to ')) { file.status = 'renamed'; continue; }
    if (raw.startsWith('index ') || raw.startsWith('--- ') || raw.startsWith('+++ ') || raw.startsWith('similarity ')) continue;
    if (raw.startsWith('Binary files')) { file.binary = true; continue; }

    if (raw.startsWith('@@')) {
      const m = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      oldLine = m ? Number(m[1]) : 0;
      newLine = m ? Number(m[3]) : 0;
      hunk = {
        header: m ? m[5].trim() : '',
        range: raw.slice(0, raw.indexOf('@@', 2) + 2),
        newStart: newLine,
        newEnd: newLine + (m && m[4] ? Number(m[4]) : 1),
        rows: [],
      };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (raw.startsWith('\\')) continue;

    const kind = raw[0] === '+' ? 'add' : raw[0] === '-' ? 'del' : 'ctx';
    const row = { kind, text: raw.slice(1) };
    if (kind === 'add') { row.new = newLine++; file.added++; }
    else if (kind === 'del') { row.old = oldLine++; file.removed++; }
    else { row.old = oldLine++; row.new = newLine++; }
    hunk.rows.push(row);
  }
  return out;
}

const esc = (s) =>
  String(s ?? '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/�/g, '&#xFFFD;');

function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}

const KEYWORDS = {
  csharp:
    'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double dynamic else enum event explicit extern false finally fixed float for foreach get global goto if implicit in init int interface internal is lock long nameof namespace new null object operator out override params partial private protected public readonly record ref return sbyte sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile when where while with yield',
  ts: 'abstract any as async await boolean break case catch class const continue declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface is keyof let namespace never new null number object of private protected public readonly return satisfies set static string super switch symbol this throw true try type typeof undefined unknown var void while yield',
  json: 'true false null',
  hcl: 'count data dependson each false for_each locals module null output provider resource terraform true var variable',
  yaml: 'false no null true yes',
  sh: 'case do done echo elif else esac export fi for function if in local return then while',
  sql: 'and as asc by case delete desc distinct else from group having in inner insert into join left not null on or order outer right select set then union update values where',
  py: 'and as assert async await break class continue def del elif else except false finally for from global if import in is lambda none nonlocal not or pass raise return true try while with yield',
  go: 'break case chan const continue default defer else fallthrough false for func go goto if import interface map nil package range return select struct switch true type var',
  css: 'important',
};

const GRAMMARS = {
  csharp: { line: '//', block: ['/*', '*/'], quotes: `"'`, pascal: true, calls: true },
  ts: { line: '//', block: ['/*', '*/'], quotes: `"'\``, pascal: true, calls: true },
  json: { quotes: '"', keys: true },
  hcl: { line: ['#', '//'], block: ['/*', '*/'], quotes: '"' },
  yaml: { line: '#', quotes: `"'` },
  sh: { line: '#', quotes: `"'` },
  sql: { line: '--', block: ['/*', '*/'], quotes: `'"` },
  py: { line: '#', quotes: `"'`, pascal: true, calls: true },
  go: { line: '//', block: ['/*', '*/'], quotes: '"`', pascal: true, calls: true },
  css: { block: ['/*', '*/'], quotes: `"'` },
  xml: { markup: true },
  none: {},
};

const EXTENSIONS = {
  cs: 'csharp', csx: 'csharp',
  ts: 'ts', tsx: 'ts', js: 'ts', jsx: 'ts', mjs: 'ts', cjs: 'ts',
  json: 'json', jsonc: 'json',
  tf: 'hcl', hcl: 'hcl', tfvars: 'hcl',
  yml: 'yaml', yaml: 'yaml',
  sh: 'sh', bash: 'sh',
  sql: 'sql',
  py: 'py',
  go: 'go',
  css: 'css', scss: 'css',
  xml: 'xml', html: 'xml', csproj: 'xml', props: 'xml', config: 'xml', targets: 'xml',
};

function langFor(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return EXTENSIONS[ext] ?? 'none';
}

const tok = (kind, text) => `<span class="t-${kind}">${esc(text)}</span>`;

function keywordSet(lang) {
  if (!keywordSet.cache) keywordSet.cache = {};
  if (!keywordSet.cache[lang]) keywordSet.cache[lang] = new Set((KEYWORDS[lang] ?? '').split(' '));
  return keywordSet.cache[lang];
}

function words(plain, lang, grammar) {
  const keys = keywordSet(lang);
  return plain.replace(/[A-Za-z_$][\w$]*|\d[\w.]*|[^A-Za-z_$\d]+/g, (piece, offset) => {
    if (/^[A-Za-z_$]/.test(piece)) {
      if (keys.has(piece)) return tok('k', piece);
      if (grammar.pascal && /^[A-Z]/.test(piece)) return tok('y', piece);
      if (grammar.calls && /^\s*\(/.test(plain.slice(offset + piece.length))) return tok('f', piece);
      return esc(piece);
    }
    if (/^\d/.test(piece)) return tok('n', piece);
    return esc(piece);
  });
}

function readString(text, start, quote) {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === quote) return i + 1;
    i++;
  }
  return text.length;
}

function startsLineComment(text, i, line) {
  const markers = Array.isArray(line) ? line : [line];
  return markers.some((marker) => text.startsWith(marker, i));
}

function paintMarkup(text) {
  return esc(text)
    .replace(/(&lt;\/?)([A-Za-z][\w:.-]*)/g, (all, open, name) => open + `<span class="t-y">${name}</span>`)
    .replace(/([\w:.-]+)=(&quot;[^&]*&quot;)/g, (all, name, value) => `<span class="t-k">${name}</span>=<span class="t-s">${value}</span>`);
}

function paint(text, lang, state) {
  const grammar = GRAMMARS[lang] ?? {};
  if (grammar.markup) return paintMarkup(text);
  if (!grammar.line && !grammar.block && !grammar.quotes) return esc(text);

  let out = '';
  let plain = '';
  let i = 0;

  const flush = () => {
    if (plain) { out += words(plain, lang, grammar); plain = ''; }
  };

  while (i < text.length) {
    if (state.block && grammar.block) {
      const close = text.indexOf(grammar.block[1], i);
      const end = close < 0 ? text.length : close + grammar.block[1].length;
      out += tok('c', text.slice(i, end));
      i = end;
      state.block = close < 0;
      continue;
    }
    if (grammar.block && text.startsWith(grammar.block[0], i)) {
      flush();
      state.block = true;
      continue;
    }
    if (grammar.line && startsLineComment(text, i, grammar.line)) {
      flush();
      out += tok('c', text.slice(i));
      return out;
    }
    if (grammar.quotes && grammar.quotes.includes(text[i])) {
      flush();
      const end = readString(text, i, text[i]);
      const literal = text.slice(i, end);
      const rest = text.slice(end);
      out += tok(grammar.keys && /^\s*:/.test(rest) ? 'key' : 's', literal);
      i = end;
      continue;
    }
    plain += text[i++];
  }

  flush();
  return out;
}

function paragraphs(s) {
  return String(s ?? '')
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((p) => `<p>${inline(p.trim())}</p>`)
    .join('');
}

const byPath = new Map(files.map((f) => [f.path, f]));
const order = [];
for (const p of notes.order ?? []) if (byPath.has(p)) order.push(byPath.get(p));
for (const f of files) if (!order.includes(f)) order.push(f);

const notesByFile = new Map();
for (const note of notes.annotations ?? []) {
  if (!notesByFile.has(note.file)) notesByFile.set(note.file, []);
  notesByFile.get(note.file).push(note);
}

let stopNumber = 0;
const route = [];

function renderNote(note) {
  const num = note.stop ? `<span class="note-num">${note.stop}</span>` : '';
  const title = note.title ? `<h4>${num}${inline(note.title)}</h4>` : num;
  return `<aside class="note">${title}${paragraphs(note.text)}</aside>`;
}

function pairRows(rows) {
  const pairs = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind === 'ctx') {
      pairs.push({ left: rows[i], right: rows[i] });
      i++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < rows.length && rows[i].kind === 'del') dels.push(rows[i++]);
    while (i < rows.length && rows[i].kind === 'add') adds.push(rows[i++]);
    const span = Math.max(dels.length, adds.length);
    for (let k = 0; k < span; k++) pairs.push({ left: dels[k] ?? null, right: adds[k] ?? null });
  }
  return pairs;
}

function cell(row, side) {
  if (!row) return `<div class="row filler"><span class="ln"></span><code>&nbsp;</code></div>`;
  const kind = row.kind === 'ctx' ? 'ctx' : side;
  const num = side === 'del' ? row.old : row.new;
  return `<div class="row ${kind}"><span class="ln">${num ?? ''}</span><code>${row.html || '&nbsp;'}</code></div>`;
}

function segment(rows, note, bar, status) {
  const oneSided = status === 'new' || status === 'deleted';
  const gutter = oneSided ? ' one-gutter' : '';

  const unified = rows
    .map((r) => {
      const numbers = oneSided
        ? `<span class="ln">${(status === 'new' ? r.new : r.old) ?? ''}</span>`
        : `<span class="ln">${r.old ?? ''}</span><span class="ln">${r.new ?? ''}</span>`;
      const mark = r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' ';
      return `<div class="row ${r.kind}">${numbers}<code>${mark}${r.html || '&nbsp;'}</code></div>`;
    })
    .join('');

  const pairs = pairRows(rows);
  const left = `<div class="pane">${pairs.map((p) => cell(p.left, 'del')).join('')}</div>`;
  const right = `<div class="pane">${pairs.map((p) => cell(p.right, 'add')).join('')}</div>`;
  const panes =
    status === 'new'
      ? `<div class="panes single">${right}</div>`
      : status === 'deleted'
        ? `<div class="panes single">${left}</div>`
        : `<div class="panes">${left}${right}</div>`;

  const aside = note ? renderNote(note) : '';

  return `<section class="hunk${aside ? ' annotated' : ''}">
  <div class="code unified${gutter}">${bar}${unified}</div>
  <div class="code split">${bar}${panes}</div>
  <div class="margin${aside ? '' : ' empty'}">${aside}</div>
</section>`;
}

function renderHunk(hunk, pending, status) {
  const context = hunk.header ? `<span class="hunk-ctx">${esc(hunk.header)}</span>` : '';
  const bar = `<div class="hunk-bar"><span class="hunk-range">${esc(hunk.range)}</span>${context}</div>`;

  const marks = [...pending].sort((a, b) => a.line - b.line);
  if (marks.length === 0) return segment(hunk.rows, null, bar, status);

  const cuts = [];
  let current = { note: null, rows: [] };
  let next = 0;
  let line = hunk.newStart;

  for (const row of hunk.rows) {
    if (row.new != null) line = row.new;
    while (next < marks.length && line >= marks[next].line) {
      if (current.rows.length > 0 || current.note) cuts.push(current);
      current = { note: marks[next], rows: [] };
      next++;
    }
    current.rows.push(row);
  }
  cuts.push(current);
  for (; next < marks.length; next++) cuts.push({ note: marks[next], rows: [] });

  return cuts.map((c, i) => segment(c.rows, c.note, i === 0 ? bar : '', status)).join('');
}

function renderFile(file) {
  const fileNotes = notesByFile.get(file.path) ?? [];
  const headNotes = fileNotes.filter((n) => n.line == null);
  const annotated = fileNotes.length > 0;

  for (const n of fileNotes) if (n.title) n.stop = ++stopNumber;
  if (annotated) route.push({ path: file.path, notes: fileNotes });

  const lang = langFor(file.path);
  const ahead = { block: false };
  const behind = { block: false };
  for (const hunk of file.hunks) {
    ahead.block = false;
    behind.block = false;
    for (const row of hunk.rows) {
      if (row.kind === 'del') {
        row.html = paint(row.text, lang, behind);
      } else {
        row.html = paint(row.text, lang, ahead);
        behind.block = ahead.block;
      }
    }
  }

  const body = file.binary
    ? '<p class="empty">Binary file.</p>'
    : file.hunks
        .map((h) => {
          const pending = fileNotes.filter((n) => n.line != null && n.line >= h.newStart && n.line <= h.newEnd);
          return renderHunk(h, pending, file.status);
        })
        .join('');

  const orphans = fileNotes.filter(
    (n) => n.line != null && !file.hunks.some((h) => n.line >= h.newStart && n.line <= h.newEnd)
  );

  const id = file.path.replace(/[^a-zA-Z0-9]/g, '-');
  const stat = `<span class="stat"><span class="plus">+${file.added}</span> <span class="minus">−${file.removed}</span></span>`;
  const flag = file.status !== 'changed' ? `<span class="flag">${file.status}</span>` : '';
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : '';
  const base = file.path.slice(dir.length);

  return `<details class="file${annotated ? ' has-notes' : ''}" id="${id}" open>
  <summary><span class="path"><span class="dir">${esc(dir)}</span>${esc(base)}</span>${flag}${stat}${
    annotated ? `<span class="badge">${fileNotes.filter((n) => n.title).length} note${fileNotes.filter((n) => n.title).length === 1 ? '' : 's'}</span>` : ''
  }</summary>
  ${headNotes.length ? `<div class="file-notes">${headNotes.map(renderNote).join('')}</div>` : ''}
  ${orphans.length ? `<div class="file-notes">${orphans.map(renderNote).join('')}</div>` : ''}
  ${body}
</details>`;
}

const fileHtml = order.map(renderFile).join('\n');

const routeHtml = route
  .map(
    (r) => `<li><a href="#${r.path.replace(/[^a-zA-Z0-9]/g, '-')}">
      <span class="route-file">${esc(r.path.split('/').pop())}</span>
      ${r.notes
        .filter((n) => n.title)
        .map((n) => `<span class="route-note"><span class="route-num">${n.stop}</span>${esc(n.title)}</span>`)
        .join('')}
    </a></li>`
  )
  .join('');

const THEMES = {
  plex: {
    label: 'Plex',
    light: {
      ground: '#fbfbfc', surface: '#ffffff', sunk: '#f3f4f7', rule: '#e2e4ea', filler: '#f7f8fa',
      ink: '#16181d', 'ink-soft': '#5b616f', 'ink-faint': '#8b91a0',
      accent: '#1f5fa9', 'accent-soft': '#eaf1f9',
      'add-bg': '#e9f4ec', 'add-ink': '#1b3a25', 'add-mark': '#2f7d46',
      'del-bg': '#fdeceb', 'del-ink': '#3d1a19', 'del-mark': '#b3403f',
      'tok-k': '#8250a8', 'tok-s': '#a04a1e', 'tok-c': '#586070',
      'tok-n': '#10656b', 'tok-y': '#1f5fa9', 'tok-key': '#1b4f8a',
      'tok-f': '#7a5200',
    },
    dark: {
      ground: '#131519', surface: '#181b21', sunk: '#1e222a', rule: '#2b3039', filler: '#15181d',
      ink: '#e7e9ee', 'ink-soft': '#a2a9b8', 'ink-faint': '#6f7787',
      accent: '#7fb2ef', 'accent-soft': '#1b2735',
      'add-bg': '#16281c', 'add-ink': '#cfe8d6', 'add-mark': '#4c9a64',
      'del-bg': '#2c1a1a', 'del-ink': '#f0d4d2', 'del-mark': '#cd6260',
      'tok-k': '#cba0ec', 'tok-s': '#e8a877', 'tok-c': '#a3abba',
      'tok-n': '#63cdc2', 'tok-y': '#86b6ef', 'tok-key': '#9dc6f5',
      'tok-f': '#e5c07b',
    },
  },
  graphite: {
    label: 'Graphite',
    light: {
      ground: '#f7f7f7', surface: '#ffffff', sunk: '#eeeeee', rule: '#dcdcdc', filler: '#f2f2f2',
      ink: '#1b1b1b', 'ink-soft': '#5c5c5c', 'ink-faint': '#8c8c8c',
      accent: '#3c6b8f', 'accent-soft': '#e9eff4',
      'add-bg': '#e4efe6', 'add-ink': '#1f3527', 'add-mark': '#3a7a4d',
      'del-bg': '#f6e6e5', 'del-ink': '#3a1f1e', 'del-mark': '#a75452',
      'tok-k': '#4a4a6a', 'tok-s': '#6b5330', 'tok-c': '#6b6b6b',
      'tok-n': '#3f5f5f', 'tok-y': '#3c6b8f', 'tok-key': '#3c6b8f',
      'tok-f': '#6a6038',
    },
    dark: {
      ground: '#1a1a1a', surface: '#212121', sunk: '#272727', rule: '#383838', filler: '#1d1d1d',
      ink: '#e8e8e8', 'ink-soft': '#a8a8a8', 'ink-faint': '#787878',
      accent: '#89b4d4', 'accent-soft': '#20303a',
      'add-bg': '#1d2a20', 'add-ink': '#d4e4d8', 'add-mark': '#5f9c70',
      'del-bg': '#2e2020', 'del-ink': '#eed7d5', 'del-mark': '#c07a78',
      'tok-k': '#b0b0d8', 'tok-s': '#d6bb8e', 'tok-c': '#a6a6a6',
      'tok-n': '#8fc4c4', 'tok-y': '#89b4d4', 'tok-key': '#89b4d4',
      'tok-f': '#cabf9a',
    },
  },
  parchment: {
    label: 'Parchment',
    light: {
      ground: '#faf8f3', surface: '#fffefb', sunk: '#f2efe6', rule: '#e0dbcd', filler: '#f5f2ea',
      ink: '#221f18', 'ink-soft': '#5f5a4c', 'ink-faint': '#8f8878',
      accent: '#1f6a63', 'accent-soft': '#e6f0ee',
      'add-bg': '#e8f1e4', 'add-ink': '#22331a', 'add-mark': '#4a7c3a',
      'del-bg': '#f8e9e2', 'del-ink': '#3b2019', 'del-mark': '#a9553e',
      'tok-k': '#7a4a86', 'tok-s': '#8c5321', 'tok-c': '#6f6858',
      'tok-n': '#2a6a5c', 'tok-y': '#1f6a63', 'tok-key': '#2f5e86',
      'tok-f': '#855f18',
    },
    dark: {
      ground: '#1a1814', surface: '#211e19', sunk: '#282420', rule: '#39342c', filler: '#1d1b17',
      ink: '#ece7dc', 'ink-soft': '#a8a191', 'ink-faint': '#7a7365',
      accent: '#6fc0b3', 'accent-soft': '#1f2f2c',
      'add-bg': '#1f2a1b', 'add-ink': '#d9e6d2', 'add-mark': '#6fa05c',
      'del-bg': '#2f211b', 'del-ink': '#efd9cf', 'del-mark': '#c47e63',
      'tok-k': '#d0a0dc', 'tok-s': '#e2b07a', 'tok-c': '#a79f8e',
      'tok-n': '#7fc9b8', 'tok-y': '#6fc0b3', 'tok-key': '#8fb6dc',
      'tok-f': '#dbc07a',
    },
  },
  oxide: {
    label: 'Oxide',
    light: {
      ground: '#f6f7f9', surface: '#ffffff', sunk: '#eceef2', rule: '#d9dde4', filler: '#f1f3f6',
      ink: '#10151c', 'ink-soft': '#4e5665', 'ink-faint': '#828b9b',
      accent: '#b4552d', 'accent-soft': '#f7ece6',
      'add-bg': '#e3f0ea', 'add-ink': '#123227', 'add-mark': '#1f7a5c',
      'del-bg': '#f9e8e6', 'del-ink': '#39191a', 'del-mark': '#b1443f',
      'tok-k': '#1f5fa9', 'tok-s': '#7a4a1c', 'tok-c': '#636c7c',
      'tok-n': '#7a2f7a', 'tok-y': '#0f6b63', 'tok-key': '#b4552d',
      'tok-f': '#8a5b00',
    },
    dark: {
      ground: '#101318', surface: '#161a20', sunk: '#1c2128', rule: '#2a313b', filler: '#131720',
      ink: '#e4e8ef', 'ink-soft': '#9aa3b2', 'ink-faint': '#69727f',
      accent: '#e8865a', 'accent-soft': '#2a1e18',
      'add-bg': '#13291f', 'add-ink': '#cde7da', 'add-mark': '#3f9b76',
      'del-bg': '#2b1a1a', 'del-ink': '#f2d6d3', 'del-mark': '#cf6a64',
      'tok-k': '#7fb2ef', 'tok-s': '#d9a978', 'tok-c': '#909aa8',
      'tok-n': '#d08fd0', 'tok-y': '#5fc3b8', 'tok-key': '#e8865a',
      'tok-f': '#e3bd72',
    },
  },
  'oxide-hard': {
    label: 'Oxide Hard',
    light: {
      ground: '#ffffff', surface: '#ffffff', sunk: '#eeeff1', rule: '#c6cad1', filler: '#f6f7f8',
      ink: '#000000', 'ink-soft': '#353a42', 'ink-faint': '#676d77',
      accent: '#c2410c', 'accent-soft': '#fdeee6',
      'add-bg': '#dbf5e4', 'add-ink': '#000000', 'add-mark': '#0b7a3b',
      'del-bg': '#ffe0de', 'del-ink': '#000000', 'del-mark': '#c0302b',
      'tok-k': '#0b46cc', 'tok-s': '#8f4400', 'tok-c': '#454b54',
      'tok-n': '#a3008f', 'tok-y': '#00675e', 'tok-key': '#c2410c',
      'tok-f': '#7a5200',
    },
    dark: {
      ground: '#000000', surface: '#08080a', sunk: '#121216', rule: '#32323a', filler: '#050507',
      ink: '#ffffff', 'ink-soft': '#ced2da', 'ink-faint': '#8b919c',
      accent: '#ff7a45', 'accent-soft': '#2b1308',
      'add-bg': '#0a2a17', 'add-ink': '#ffffff', 'add-mark': '#2fd178',
      'del-bg': '#300e0f', 'del-ink': '#ffffff', 'del-mark': '#ff6b65',
      'tok-k': '#6db3ff', 'tok-s': '#ffb86c', 'tok-c': '#aeb7c4',
      'tok-n': '#ff8ae2', 'tok-y': '#3fe0cd', 'tok-key': '#ff7a45',
      'tok-f': '#ffd479',
    },
  },
};

const DEFAULT_THEME = 'oxide-hard';

const vars = (palette, indent) =>
  Object.entries(palette)
    .map(([name, value]) => `${indent}--${name}: ${value};`)
    .join('\n');

function themeCss() {
  const blocks = [`:root {\n${vars(THEMES[DEFAULT_THEME].light, '  ')}\n}`];

  for (const [id, theme] of Object.entries(THEMES)) {
    blocks.push(`.shell[data-skin="${id}"] {\n${vars(theme.light, '  ')}\n}`);
    blocks.push(
      `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) .shell[data-skin="${id}"] {\n${vars(
        theme.dark,
        '    '
      )}\n  }\n}`
    );
    blocks.push(`:root[data-theme="dark"] .shell[data-skin="${id}"] {\n${vars(theme.dark, '  ')}\n}`);
  }

  blocks.push(
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${vars(
      THEMES[DEFAULT_THEME].dark,
      '    '
    )}\n  }\n}`,
    `:root[data-theme="dark"] {\n${vars(THEMES[DEFAULT_THEME].dark, '  ')}\n}`
  );

  return blocks.join('\n');
}

const skinOptions = Object.entries(THEMES)
  .map(([id, theme]) => `<option value="${id}">${theme.label}</option>`)
  .join('');

const meta = notes.pr ?? {};
const totals = files.reduce((a, f) => ({ added: a.added + f.added, removed: a.removed + f.removed }), { added: 0, removed: 0 });

const html = `<title>${esc(meta.title ? `${meta.repo ?? ''} #${meta.number} walkthrough` : 'PR walkthrough')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:ital,wght@0,400;0,500;1,400&display=swap">
<style>
${themeCss()}
:root {
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --sans: "IBM Plex Sans", system-ui, -apple-system, sans-serif;
  --serif: "IBM Plex Serif", Georgia, serif;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.55;
}
a { color: var(--accent); }
code { font-family: var(--mono); }

.shell { display: grid; grid-template-columns: 1fr; gap: 0; width: 100%; min-height: 100vh; background: var(--ground); color: var(--ink); }
@media (min-width: 1100px) {
  .shell { grid-template-columns: 15rem minmax(0, 1fr); align-items: start; }
}
.rail { padding: 1.4rem 0.85rem; border-bottom: 1px solid var(--rule); }
@media (min-width: 1100px) {
  .rail { position: sticky; top: 0; max-height: 100vh; overflow-y: auto; border-bottom: 0; border-right: 1px solid var(--rule); }
}
.rail-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
.rail h2 {
  font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.09em;
  color: var(--ink-faint); margin: 0; font-weight: 600; flex: 1;
}
.rail-toggle {
  flex: none; width: 1.6rem; height: 1.6rem; padding: 0; cursor: pointer;
  border: 1px solid var(--rule); border-radius: 3px;
  background: var(--surface); color: var(--ink-soft);
  font-family: var(--mono); font-size: 0.8rem; line-height: 1;
}
.rail-toggle::before { content: "\\00AB"; }
.rail-toggle:hover { border-color: var(--accent); color: var(--accent); }
.rail-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.shell[data-rail="closed"] .rail-toggle::before { content: "\\00BB"; }
.shell[data-rail="closed"] .rail { padding-left: 0.5rem; padding-right: 0.5rem; }
.shell[data-rail="closed"] .rail h2,
.shell[data-rail="closed"] .rail ol { display: none; }
@media (min-width: 1100px) {
  .shell[data-rail="closed"] { grid-template-columns: 2.6rem minmax(0, 1fr); }
}
.rail ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.rail a { display: flex; flex-direction: column; gap: 0.15rem; text-decoration: none; padding: 0.45rem 0.5rem; border-radius: 3px; }
.rail a:hover, .rail a:focus-visible { background: var(--accent-soft); outline: none; }
.route-file { font-family: var(--mono); font-size: 0.76rem; color: var(--ink-soft); word-break: break-all; }
.route-note { display: flex; gap: 0.4rem; font-size: 0.82rem; color: var(--ink); }
.route-num, .note-num {
  flex: none; display: inline-grid; place-items: center;
  width: 1.3rem; height: 1.3rem; border-radius: 50%;
  background: var(--accent); color: var(--surface);
  font-family: var(--sans); font-size: 0.7rem; font-weight: 600;
  font-variant-numeric: tabular-nums;
}
main { padding: 1.4rem 0.75rem 5rem; min-width: 0; }
@media (min-width: 1100px) { main { padding: 2rem 1rem 5rem; } }

.masthead { max-width: 62ch; margin-bottom: 1.75rem; }
.eyebrow { font-family: var(--mono); font-size: 0.78rem; color: var(--ink-faint); display: flex; flex-wrap: wrap; gap: 0.75rem; }
.masthead h1 {
  font-size: clamp(1.5rem, 3.2vw, 2.1rem); line-height: 1.2; text-wrap: balance;
  margin: 0.6rem 0 1rem; font-weight: 600; letter-spacing: -0.015em;
}
.masthead .lede { font-family: var(--serif); font-size: 1.05rem; line-height: 1.65; margin: 0 0 1.25rem; }
.why {
  font-family: var(--serif); border-left: 2px solid var(--accent);
  padding: 0.1rem 0 0.1rem 1rem; margin: 0 0 1.25rem; color: var(--ink-soft);
}
.why h3 {
  font-family: var(--sans); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.09em;
  color: var(--accent); margin: 0 0 0.35rem; font-weight: 600;
}
.why p { margin: 0 0 0.6rem; }
.why p:last-child { margin-bottom: 0; }
.totals { font-family: var(--mono); font-size: 0.8rem; color: var(--ink-faint); font-variant-numeric: tabular-nums; }
.file { border: 1px solid var(--rule); border-radius: 4px; background: var(--surface); margin-bottom: 0.85rem; overflow: hidden; }
.file.has-notes { border-color: color-mix(in srgb, var(--accent) 35%, var(--rule)); }
.file > summary {
  display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
  padding: 0.5rem 0.7rem; cursor: pointer; background: var(--sunk);
  border-bottom: 1px solid var(--rule); list-style: none;
}
.file > summary::-webkit-details-marker { display: none; }
.file > summary::before { content: "▸"; color: var(--ink-faint); font-size: 0.7rem; }
.file[open] > summary::before { content: "▾"; }
.file > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.path { font-family: var(--mono); font-size: 0.82rem; word-break: break-all; font-weight: 600; }
.dir { color: var(--ink-faint); font-weight: 400; }
.stat { font-family: var(--mono); font-size: 0.76rem; font-variant-numeric: tabular-nums; margin-left: auto; }
.plus { color: var(--add-mark); }
.minus { color: var(--del-mark); }
.flag {
  font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600;
  color: var(--ink-soft); border: 1px solid var(--rule); border-radius: 2px; padding: 0.05rem 0.35rem;
}
.badge {
  font-size: 0.68rem; font-weight: 600; color: var(--surface); background: var(--accent);
  border-radius: 2px; padding: 0.1rem 0.4rem;
}
.hunk { display: grid; grid-template-columns: minmax(0, 1fr); }
.margin.empty { display: none; }
@media (min-width: 1200px) {
  .shell[data-view="unified"] .hunk { grid-template-columns: minmax(0, 1fr) 24rem; }
  .shell[data-view="unified"] .margin.empty { display: block; }
}
@media (min-width: 1500px) {
  .shell[data-view="split"] .hunk { grid-template-columns: minmax(0, 1fr) 24rem; }
  .shell[data-view="split"] .margin.empty { display: block; }
}
@media (min-width: 2200px) {
  .hunk { grid-template-columns: minmax(0, 1fr) 30rem; }
}
.code { min-width: 0; padding-bottom: 0.2rem; }
.code.unified { overflow-x: auto; }
.shell[data-view="split"] .code.unified { display: none; }
.shell[data-view="unified"] .code.split { display: none; }
.panes { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.panes.single { grid-template-columns: minmax(0, 1fr); }
.pane { overflow-x: auto; min-width: 0; }
.pane + .pane { border-left: 1px solid var(--rule); }
.pane .row { grid-template-columns: 2.9rem minmax(0, 1fr); }
.code.one-gutter .row { grid-template-columns: 2.9rem minmax(0, 1fr); }
.row.filler { background: var(--filler); }

.t-k { color: var(--tok-k); }
.t-s { color: var(--tok-s); }
.t-c { color: var(--tok-c); }
.t-n { color: var(--tok-n); }
.t-y { color: var(--tok-y); }
.t-key { color: var(--tok-key); }
.t-f { color: var(--tok-f); }
.hunk + .hunk .code { border-top: 1px solid var(--rule); }

.toolbar { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 0.85rem; }
.seg { display: inline-flex; border: 1px solid var(--rule); border-radius: 3px; overflow: hidden; }
.seg button {
  font-family: var(--sans); font-size: 0.78rem; font-weight: 500;
  padding: 0.3rem 0.7rem; border: 0; cursor: pointer;
  background: var(--surface); color: var(--ink-soft);
}
.seg button + button { border-left: 1px solid var(--rule); }
.seg button.on { background: var(--accent); color: var(--surface); }
.seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.skin { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; color: var(--ink-faint); }
.skin select {
  font-family: var(--sans); font-size: 0.78rem; padding: 0.28rem 0.4rem;
  border: 1px solid var(--rule); border-radius: 3px;
  background: var(--surface); color: var(--ink);
}
.skin select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.hunk-bar {
  display: flex; gap: 1rem; padding: 0.3rem 0.6rem;
  background: var(--sunk); color: var(--ink-faint);
  font-family: var(--mono); font-size: 0.74rem; white-space: nowrap;
}
.hunk-ctx { color: var(--ink-soft); }
.row { display: grid; grid-template-columns: 2.9rem 2.9rem minmax(0, 1fr); align-items: baseline; }
.row code {
  font-size: 0.8rem; line-height: 1.5; white-space: pre; padding-right: 0.5rem; font-weight: 500;
  color: var(--ink);
}
.ln {
  font-family: var(--mono); font-size: 0.7rem; color: var(--ink-faint);
  text-align: right; padding-right: 0.55rem; user-select: none;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.row.add { background: var(--add-bg); }
.row.add code { color: var(--add-ink); }
.row.del { background: var(--del-bg); }
.row.del code { color: var(--del-ink); }
.margin { border-left: 1px solid var(--rule); padding: 0.75rem 0.8rem; background: var(--surface); }
@media (max-width: 1399px) { .margin { border-left: 0; border-top: 1px solid var(--rule); } }
.file-notes { padding: 0.75rem 0.8rem 0; }
.note {
  font-family: var(--serif); font-size: 0.92rem; line-height: 1.6; color: var(--ink-soft);
  border-left: 2px solid var(--accent); padding-left: 0.85rem;
}
.note + .note { margin-top: 1rem; }
.note h4 {
  font-family: var(--sans); font-size: 0.84rem; font-weight: 600; color: var(--ink);
  margin: 0 0 0.45rem; display: flex; align-items: center; gap: 0.45rem; text-wrap: balance;
}
.note p { margin: 0 0 0.6rem; }
.note p:last-child { margin-bottom: 0; }
.note code, .why code, .masthead code {
  font-size: 0.85em; background: var(--sunk); border-radius: 2px; padding: 0.05em 0.3em; color: var(--ink);
}
.empty { padding: 1rem; color: var(--ink-faint); font-family: var(--serif); }

@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>

<div class="shell" data-view="split" data-skin="${DEFAULT_THEME}">
  <nav class="rail">
    <div class="rail-head">
      <h2>Reading order</h2>
      <button type="button" class="rail-toggle" aria-expanded="true" aria-controls="route" title="Collapse reading order"></button>
    </div>
    <ol id="route">${routeHtml}</ol>
  </nav>
  <main>
    <header class="masthead">
      <div class="eyebrow">
        <span>${esc(meta.repo ?? '')} #${esc(meta.number ?? '')}</span>
        <span>${esc(meta.author ?? '')}</span>
        <span>${esc(meta.head ?? '')} → ${esc(meta.base ?? '')}</span>
        <span class="totals">+${totals.added} −${totals.removed} · ${files.length} files</span>
      </div>
      <h1>${esc(meta.title ?? '')}</h1>
      <div class="lede">${paragraphs(notes.summary)}</div>
      <div class="why"><h3>Why</h3>${paragraphs(notes.why)}</div>
      ${meta.url ? `<p class="totals"><a href="${esc(meta.url)}">${esc(meta.url)}</a></p>` : ''}
    </header>
    <div class="toolbar"><div class="seg" role="group" aria-label="Diff view"><button type="button" data-set="split">Side by side</button><button type="button" data-set="unified">Unified</button></div><label class="skin"><span>Theme</span><select id="skin">${skinOptions}</select></label></div>
    ${fileHtml}
  </main>
</div>
<script>
(function () {
  var shell = document.querySelector('.shell');
  var buttons = document.querySelectorAll('.seg button');
  try {
    var saved = localStorage.getItem('pr-walkthrough-view');
    if (saved === 'split' || saved === 'unified') shell.dataset.view = saved;
  } catch (e) {}
  function sync() {
    buttons.forEach(function (b) { b.classList.toggle('on', b.dataset.set === shell.dataset.view); });
  }
  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      shell.dataset.view = b.dataset.set;
      try { localStorage.setItem('pr-walkthrough-view', b.dataset.set); } catch (e) {}
      sync();
    });
  });
  sync();

  var skin = document.getElementById('skin');
  try {
    var savedSkin = localStorage.getItem('pr-walkthrough-skin');
    if (savedSkin && skin.querySelector('option[value="' + savedSkin + '"]')) shell.dataset.skin = savedSkin;
  } catch (e) {}
  skin.value = shell.dataset.skin;
  skin.addEventListener('change', function () {
    shell.dataset.skin = skin.value;
    try { localStorage.setItem('pr-walkthrough-skin', skin.value); } catch (e) {}
  });

  var rail = document.querySelector('.rail-toggle');
  function railState(closed) {
    shell.dataset.rail = closed ? 'closed' : 'open';
    rail.setAttribute('aria-expanded', closed ? 'false' : 'true');
    rail.title = closed ? 'Show reading order' : 'Collapse reading order';
  }
  try {
    railState(localStorage.getItem('pr-walkthrough-rail') === 'closed');
  } catch (e) {
    railState(false);
  }
  rail.addEventListener('click', function () {
    var closed = shell.dataset.rail !== 'closed';
    railState(closed);
    try { localStorage.setItem('pr-walkthrough-rail', closed ? 'closed' : 'open'); } catch (e) {}
  });

  function link(group) {
    if (group.length < 2) return;
    var locked = false;
    group.forEach(function (pane) {
      pane.addEventListener('scroll', function () {
        if (locked) return;
        locked = true;
        group.forEach(function (other) {
          if (other !== pane) other.scrollLeft = pane.scrollLeft;
        });
        requestAnimationFrame(function () { locked = false; });
      });
    });
  }

  document.querySelectorAll('.file').forEach(function (file) {
    var left = [];
    var right = [];
    file.querySelectorAll('.panes').forEach(function (panes) {
      if (panes.children[0]) left.push(panes.children[0]);
      if (panes.children[1]) right.push(panes.children[1]);
    });
    link(left);
    link(right);
    link([].slice.call(file.querySelectorAll('.code.unified')));
  });
})();
</script>
`;

writeFileSync(outPath, html);
console.log(`wrote ${outPath} — ${files.length} files, ${stopNumber} notes`);
