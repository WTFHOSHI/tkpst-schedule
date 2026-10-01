// Посещаемость: общие функции (даты, итоги, Excel). Работает и в браузере, и в Node (для тестов).
// Ничего не знает про сеть — данные передаются параметрами.

/** Отметки. P — был, N — нет, B — болеет, U — уважительная, R — работа, Z — по заявлению. */
export const MARKS = [
  { code: 'P', label: '✓', title: 'Был на паре', short: 'был', fill: 'C6EFCE', color: '006100' },
  { code: 'N', label: 'Н', title: 'Не был, неуважительная причина', short: 'неуваж.', fill: 'FFC7CE', color: '9C0006' },
  { code: 'B', label: 'Б', title: 'Болеет', short: 'болеет', fill: 'FFEB9C', color: '7A4A00' },
  { code: 'U', label: 'У', title: 'Уважительная причина', short: 'уваж.', fill: 'BDD7EE', color: '1F4E79' },
  { code: 'R', label: 'Р', title: 'Работает', short: 'работа', fill: 'E4DFEC', color: '5B2C6F' },
  { code: 'Z', label: 'З', title: 'По заявлению', short: 'заявл.', fill: 'C9EDE8', color: '0B5E57' },
];
export const MARK = Object.fromEntries(MARKS.map((m) => [m.code, m]));
export const ABSENT = ['N', 'B', 'U', 'R', 'Z'];

// ---------------- Даты (строки YYYY-MM-DD, без часовых поясов) ----------------

const DAY = 864e5;
export const toMs = (iso) => Date.parse(iso + 'T00:00:00Z');
export const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, n) => fromMs(toMs(iso) + n * DAY);
export const weekday = (iso) => { const d = new Date(toMs(iso)).getUTCDay(); return d === 0 ? 7 : d; };
export const mondayOf = (iso) => addDays(iso, 1 - weekday(iso));
export const weekDays = (monday) => [0, 1, 2, 3, 4, 5].map((i) => addDays(monday, i));
export const ym = (iso) => iso.slice(0, 7);
export const ddmm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
export const ddmmyyyy = (iso) => `${ddmm(iso)}.${iso.slice(0, 4)}`;

export const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const dMonth = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]}`;
export const dMon = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;
export const monthTitle = (ymStr) => { const [y, m] = ymStr.split('-').map(Number); return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`; };

/** Учебный год, в котором лежит дата: 2026-10-02 → 2026 (сентябрь 2026 – август 2027). */
export const studyYear = (iso) => { const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)); return m >= 8 ? y : y - 1; };
/** Месяцы учебного года: сентябрь … июнь. */
export const studyMonths = (year) => [9, 10, 11, 12, 1, 2, 3, 4, 5, 6].map((m) => `${m >= 9 ? year : year + 1}-${String(m).padStart(2, '0')}`);
/** Понедельники недель, у которых хотя бы один учебный день (Пн–Сб) попадает в месяц. */
export function weeksOfMonth(ymStr) {
  const first = ymStr + '-01';
  const out = [];
  for (let m = mondayOf(first); ; m = addDays(m, 7)) {
    const days = weekDays(m);
    if (days.some((d) => ym(d) === ymStr)) out.push(m);
    else if (days[0] > first) break;
  }
  return out;
}
/** Месяц недели для навигации: месяц большинства её учебных дней. */
export const monthOfWeek = (monday) => ym(addDays(monday, 3));

// ---------------- Студенты, пары, итоги ----------------

/** Студенты, которые числятся хотя бы в один день из отрезка [from, to]. */
export const activeStudents = (students, from, to) => (students || []).filter((s) => (!s.from || s.from <= to) && (!s.to || s.to >= from));

export const markOf = (week, sid, iso, pair) => (week && week.m && week.m[sid] && week.m[sid][iso] && week.m[sid][iso][pair]) || null;

/** Пары дня: по расписанию + те, где уже стоят отметки + сохранённые в неделе. */
export function dayPairs(week, iso, schedule) {
  const set = new Set(schedule || []);
  for (const n of (week && week.pairs && week.pairs[iso]) || []) set.add(Number(n));
  for (const days of Object.values((week && week.m) || {})) for (const p of Object.keys(days[iso] || {})) set.add(Number(p));
  return [...set].filter((n) => n > 0).sort((a, b) => a - b);
}

/** Итоги студента: {P, N, B, U, R, Z, absent, total, rate}. dayOk(iso) — какие дни считать. */
export function studentTotals(sid, weeks, dayOk = () => true) {
  const t = { P: 0, N: 0, B: 0, U: 0, R: 0, Z: 0 };
  for (const w of Object.values(weeks || {})) {
    const days = (w && w.m && w.m[sid]) || {};
    for (const [iso, pairs] of Object.entries(days)) {
      if (!dayOk(iso)) continue;
      for (const v of Object.values(pairs)) if (v in t) t[v]++;
    }
  }
  t.absent = ABSENT.reduce((a, k) => a + t[k], 0);
  t.total = t.P + t.absent;
  t.rate = t.total ? t.P / t.total : null;
  return t;
}

// ---------------- Запись .xlsx (свой маленький генератор, без библиотек) ----------------

const enc = new TextEncoder();
const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
export const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** ZIP без сжатия. files: [{name, data: Uint8Array}] → Uint8Array */
export function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  const dosTime = 0, dosDate = (2026 - 1980) << 9 | 1 << 5 | 1;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

// Стили ячеек. Индексы — позиции в cellXfs ниже.
const S = { def: 0, title: 1, hdr: 2, name: 3, num: 4, empty: 11, totHdr: 12, tot: 13, sub: 14, bad: 15, text: 16, hdrL: 17, pct: 18, noday: 19, totB: 20 };
MARKS.forEach((m, i) => { S['m' + m.code] = 5 + i; });

function stylesXml() {
  const font = (x = '') => `<font>${x}<sz val="11"/><name val="Calibri"/><family val="2"/></font>`;
  const fonts = [font(), font('<b/>'), `<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>`,
    ...MARKS.map((m) => font(`<b/><color rgb="FF${m.color}"/>`)), font('<i/><color rgb="FF666666"/>'), font('<b/><color rgb="FF9C0006"/>')];
  const fill = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', fill('E7ECE0'),
    ...MARKS.map((m) => fill(m.fill)), fill('F2F5EC'), fill('EFEFEF')];
  const side = (n) => `<${n} style="thin"><color rgb="FFB7BCAE"/></${n}>`;
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>', `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border>`];
  const C = '<alignment horizontal="center" vertical="center" wrapText="1"/>', Lft = '<alignment horizontal="left" vertical="center"/>';
  const xf = (font, fill, border, align = '', num = 0) => `<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${align ? ' applyAlignment="1"' : ''}${num ? ' applyNumberFormat="1"' : ''}>${align}</xf>`;
  const xfs = [
    xf(0, 0, 0), xf(2, 0, 0), xf(1, 2, 1, C), xf(0, 0, 1, Lft), xf(0, 0, 1, C),
    ...MARKS.map((m, i) => xf(3 + i, 3 + i, 1, C)),
    xf(0, 0, 1, C), xf(1, 3 + MARKS.length, 1, C), xf(0, 0, 1, C), xf(3 + MARKS.length, 0, 0), xf(4 + MARKS.length, 0, 1, C),
    xf(0, 0, 0, Lft), xf(1, 2, 1, Lft), xf(0, 0, 1, C, 9), xf(3 + MARKS.length, 4 + MARKS.length, 1, C), xf(1, 3 + MARKS.length, 1, C),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

/**
 * Собрать .xlsx. sheets: [{name, rows: [[cell|null]], merges: ['A1:C1'], cols: [ширина], freeze: {col, row}, heights: {row: h}}]
 * cell: строка/число или {v, s: имя стиля}.
 */
export function buildXlsx(sheets) {
  const strings = [], sIdx = new Map();
  const si = (s) => { s = String(s); if (!sIdx.has(s)) { sIdx.set(s, strings.length); strings.push(s); } return sIdx.get(s); };
  const used = new Set();
  const names = sheets.map((sh) => {
    let n = String(sh.name).replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Лист';
    let k = 2; const base = n;
    while (used.has(n.toLowerCase())) n = `${base.slice(0, 27)} (${k++})`;
    used.add(n.toLowerCase());
    return n;
  });
  const sheetXml = sheets.map((sh) => {
    const rows = sh.rows.map((row, ri) => {
      const cells = row.map((cell, ci) => {
        if (cell == null || cell === '') return '';
        const c = typeof cell === 'object' ? cell : { v: cell };
        const ref = colName(ci) + (ri + 1), s = S[c.s || 'def'] || 0;
        if (c.v == null || c.v === '') return `<c r="${ref}" s="${s}"/>`;
        if (typeof c.v === 'number') return `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
        return `<c r="${ref}" s="${s}" t="s"><v>${si(c.v)}</v></c>`;
      }).join('');
      const h = sh.heights && sh.heights[ri + 1];
      return `<row r="${ri + 1}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`;
    }).join('');
    const f = sh.freeze;
    const pane = f ? `<pane${f.col ? ` xSplit="${f.col}"` : ''}${f.row ? ` ySplit="${f.row}"` : ''} topLeftCell="${colName(f.col || 0)}${(f.row || 0) + 1}" activePane="${f.col && f.row ? 'bottomRight' : f.row ? 'bottomLeft' : 'topRight'}" state="frozen"/>` : '';
    const cols = (sh.cols || []).map((w, i) => w ? `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>` : '').join('');
    const merges = (sh.merges || []).length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows}</sheetData>${merges}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" paperSize="9" fitToHeight="0"/></worksheet>`;
  });
  const ssXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`;
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/styles.xml', stylesXml()],
    ...sheetXml.map((x, i) => [`xl/worksheets/sheet${i + 1}.xml`, x]),
    ['xl/sharedStrings.xml', ssXml],
  ];
  return zip(files.map(([name, text]) => ({ name, data: enc.encode(text) })));
}

// ---------------- Листы посещаемости ----------------

const TOT_COLS = [
  ...MARKS.map((m) => ({ key: m.code, title: m.label + '\n' + m.short })),
  { key: 'absent', title: 'Всего\nпропусков' },
  { key: 'hours', title: 'Часов\nпропущ.' },
  { key: 'rate', title: 'Посещае-\nмость' },
];
const totCells = (t) => TOT_COLS.map((c) => {
  if (c.key === 'rate') return { v: t.rate == null ? '' : Math.round(t.rate * 1000) / 1000, s: 'pct' };
  if (c.key === 'hours') return { v: t.absent * 2, s: 'tot' };
  if (c.key === 'absent') return { v: t.absent, s: 'totB' };
  if (c.key === 'N') return { v: t.N, s: t.N ? 'bad' : 'tot' };
  return { v: t[c.key], s: 'tot' };
});

function legendRows(width) {
  const rows = [[], [{ v: 'Обозначения', s: 'title' }]];
  for (const m of MARKS) rows.push([{ v: m.label, s: 'm' + m.code }, { v: m.title, s: 'text' }, ...Array(Math.max(0, width - 2)).fill(null)]);
  rows.push([{ v: '', s: 'empty' }, { v: 'Пусто — отметки нет', s: 'text' }]);
  rows.push([null, { v: 'Пропуски = Н + Б + У + Р + З. Одна пара = 2 часа. Посещаемость = был ÷ (был + пропуски).', s: 'sub' }]);
  return rows;
}

/** Лист одной недели. days — какие дни показать (по умолчанию Пн–Сб). */
export function weekSheet({ title, monday, week, students, schedule = {}, days, exportedAt }) {
  days = days || weekDays(monday);
  const cols = [];  // [{iso, pair|null}]
  for (const d of days) {
    const ps = dayPairs(week, d, schedule[d]);
    if (ps.length) ps.forEach((p) => cols.push({ iso: d, pair: p })); else cols.push({ iso: d, pair: null });
  }
  const list = activeStudents(students, days[0], days[days.length - 1]);
  const dayOk = (iso) => days.includes(iso);
  const nTot = TOT_COLS.length, width = 2 + cols.length + nTot;
  const rows = [], merges = [];
  rows.push([{ v: title, s: 'title' }]);
  rows.push([{ v: `Неделя ${dMonth(days[0])} – ${dMonth(days[days.length - 1])} ${days[0].slice(0, 4)}${exportedAt ? ' · выгружено ' + ddmmyyyy(exportedAt) : ''}`, s: 'sub' }]);
  rows.push([]);
  const h1 = [{ v: '№', s: 'hdr' }, { v: 'ФИО', s: 'hdrL' }], h2 = [{ v: '', s: 'hdr' }, { v: '', s: 'hdrL' }];
  merges.push('A4:A5', 'B4:B5');
  let ci = 2;
  for (const d of days) {
    const n = cols.filter((c) => c.iso === d).length;
    h1.push({ v: `${WD[weekday(d) - 1]} ${ddmm(d)}`, s: 'hdr' });
    for (let k = 1; k < n; k++) h1.push({ v: '', s: 'hdr' });
    if (n > 1) merges.push(`${colName(ci)}4:${colName(ci + n - 1)}4`);
    for (const c of cols.filter((x) => x.iso === d)) h2.push({ v: c.pair ? `${c.pair} п.` : 'нет пар', s: 'hdr' });
    ci += n;
  }
  for (const t of TOT_COLS) { h1.push({ v: t.title, s: 'totHdr' }); h2.push({ v: '', s: 'totHdr' }); merges.push(`${colName(ci)}4:${colName(ci)}5`); ci++; }
  rows.push(h1, h2);
  list.forEach((s, i) => {
    const r = [{ v: i + 1, s: 'num' }, { v: s.name + (s.to && s.to < days[days.length - 1] ? ' (выбыл)' : ''), s: 'name' }];
    for (const c of cols) {
      if (!c.pair) { r.push({ v: '', s: 'noday' }); continue; }
      const v = markOf(week, s.id, c.iso, c.pair);
      r.push(v ? { v: MARK[v].label, s: 'm' + v } : { v: '', s: 'empty' });
    }
    r.push(...totCells(studentTotals(s.id, { w: week }, dayOk)));
    rows.push(r);
  });
  // Итого по группе
  const all = { P: 0, N: 0, B: 0, U: 0, R: 0, Z: 0, absent: 0, total: 0 };
  for (const s of list) { const t = studentTotals(s.id, { w: week }, dayOk); for (const k of Object.keys(all)) all[k] += t[k]; }
  all.rate = all.total ? all.P / all.total : null;
  rows.push([null, { v: 'Итого по группе', s: 'hdrL' }, ...cols.map(() => null), ...totCells(all)]);
  rows.push(...legendRows(width));
  merges.push(`A1:${colName(Math.max(1, width - 1))}1`, `A2:${colName(Math.max(1, width - 1))}2`);
  return {
    name: `${ddmm(days[0])}-${ddmm(days[days.length - 1])}`,
    rows, merges, freeze: { col: 2, row: 5 }, heights: { 1: 24, 4: 22, 5: 32 },
    cols: [5, 34, ...cols.map((c) => (!c.pair ? 9 : cols.filter((x) => x.iso === c.iso).length === 1 ? 9 : 6)), ...TOT_COLS.map(() => 10.5)],
  };
}

/** Лист «Итоги» за период. */
export function totalsSheet({ title, period, weeks, students, dayOk, exportedAt }) {
  const rows = [[{ v: title, s: 'title' }], [{ v: `Итоги ${period}${exportedAt ? ' · выгружено ' + ddmmyyyy(exportedAt) : ''}`, s: 'sub' }], []];
  rows.push([{ v: '№', s: 'hdr' }, { v: 'ФИО', s: 'hdrL' }, ...TOT_COLS.map((t) => ({ v: t.title, s: 'totHdr' }))]);
  const all = { P: 0, N: 0, B: 0, U: 0, R: 0, Z: 0, absent: 0, total: 0 };
  students.forEach((s, i) => {
    const t = studentTotals(s.id, weeks, dayOk);
    for (const k of Object.keys(all)) all[k] += t[k];
    rows.push([{ v: i + 1, s: 'num' }, { v: s.name + (s.to ? ' (выбыл)' : ''), s: 'name' }, ...totCells(t)]);
  });
  all.rate = all.total ? all.P / all.total : null;
  rows.push([null, { v: 'Итого по группе', s: 'hdrL' }, ...totCells(all)]);
  rows.push(...legendRows(2 + TOT_COLS.length));
  return {
    name: 'Итоги', rows, freeze: { col: 2, row: 4 }, heights: { 1: 24, 4: 34 },
    merges: [`A1:${colName(1 + TOT_COLS.length)}1`, `A2:${colName(1 + TOT_COLS.length)}2`],
    cols: [5, 34, ...TOT_COLS.map(() => 11)],
  };
}

/** Лист «По месяцам»: сколько пар пропущено каждый месяц. */
export function monthsSheet({ title, weeks, students, months }) {
  const rows = [[{ v: title, s: 'title' }], [{ v: 'Пропущено пар по месяцам (в скобках — из них Н, без причины)', s: 'sub' }], []];
  rows.push([{ v: '№', s: 'hdr' }, { v: 'ФИО', s: 'hdrL' }, ...months.map((m) => ({ v: monthTitle(m), s: 'totHdr' })), { v: 'Всего', s: 'totHdr' }]);
  students.forEach((s, i) => {
    const per = months.map((m) => studentTotals(s.id, weeks, (d) => ym(d) === m));
    const all = studentTotals(s.id, weeks);
    const cell = (t) => ({ v: t.total ? `${t.absent}${t.N ? ` (${t.N})` : ''}` : '', s: t.N ? 'bad' : 'tot' });
    rows.push([{ v: i + 1, s: 'num' }, { v: s.name, s: 'name' }, ...per.map(cell), { ...cell(all), s: 'totB' }]);
  });
  return { name: 'По месяцам', rows, freeze: { col: 2, row: 4 }, heights: { 1: 24, 4: 22 }, cols: [5, 34, ...months.map(() => 13), 11],
    merges: [`A1:${colName(2 + months.length)}1`, `A2:${colName(2 + months.length)}2`] };
}

/**
 * Книга Excel. kind: 'week' | 'month' | 'course'.
 * weeks: {monday: doc}; schedule: {iso: [пары]}; key: понедельник недели или 'YYYY-MM' месяца.
 */
export function attendanceWorkbook({ kind, key, courseTitle, students, weeks, schedule = {}, exportedAt }) {
  const title = `Посещаемость · ${courseTitle}`;
  const sheets = [];
  const sortedWeeks = Object.keys(weeks).sort();
  if (kind === 'week') {
    sheets.push(weekSheet({ title, monday: key, week: weeks[key], students, schedule, exportedAt }));
    return { sheets, file: `Посещаемость ${courseTitle} ${ddmm(key)}-${ddmm(addDays(key, 5))}.${key.slice(0, 4)}.xlsx` };
  }
  if (kind === 'month') {
    const mondays = weeksOfMonth(key);
    const days = mondays.flatMap(weekDays).filter((d) => ym(d) === key);
    const studs = activeStudents(students, days[0], days[days.length - 1]);
    sheets.push(totalsSheet({ title, period: `за ${monthTitle(key).toLowerCase()}`, weeks, students: studs, dayOk: (d) => ym(d) === key, exportedAt }));
    for (const m of mondays) {
      const wd = weekDays(m).filter((d) => ym(d) === key);
      if (!weeks[m] && !wd.some((d) => (schedule[d] || []).length)) continue;
      sheets.push(weekSheet({ title, monday: m, week: weeks[m], students, schedule, days: wd, exportedAt }));
    }
    return { sheets, file: `Посещаемость ${courseTitle} ${monthTitle(key)}.xlsx` };
  }
  // Весь курс
  const from = sortedWeeks[0], to = sortedWeeks.length ? addDays(sortedWeeks[sortedWeeks.length - 1], 5) : null;
  const studs = from ? activeStudents(students, from, to) : students;
  const months = [...new Set(sortedWeeks.flatMap((m) => weekDays(m)).filter((d) => sortedWeeks.some((w) => weeks[w] && Object.values(weeks[w].m || {}).some((x) => x[d]))).map(ym))].sort();
  sheets.push(totalsSheet({ title, period: from ? `с ${dMonth(from)} ${from.slice(0, 4)} по ${dMonth(to)} ${to.slice(0, 4)}` : '(данных нет)', weeks, students: studs, exportedAt }));
  if (months.length) sheets.push(monthsSheet({ title, weeks, students: studs, months }));
  for (const m of sortedWeeks) sheets.push(weekSheet({ title, monday: m, week: weeks[m], students, schedule, exportedAt }));
  return { sheets, file: `Посещаемость ${courseTitle} весь курс.xlsx` };
}

// ---------------- Чтение старой таблицы .xlsx ----------------

const xmlUnesc = (s) => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e) => (
  { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));

/** Распаковать ZIP (store/deflate). → Map(имя → Uint8Array) */
export async function unzip(buf) {
  const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Это не файл Excel (.xlsx)');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Повреждённый файл');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = b.subarray(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
  }
  return out;
}

const OLD_CODES = { '+': 'P', '✓': 'P', 'н': 'N', 'нб': 'B', 'б': 'B', 'у': 'U', 'ну': 'U', 'нр': 'R', 'р': 'R', 'нз': 'Z', 'з': 'Z' };
export const oldCode = (v) => OLD_CODES[String(v ?? '').replace(/["'\s]/g, '').toLowerCase()] || null;
const serialToIso = (n) => fromMs(Date.UTC(1899, 11, 30) + Math.round(n) * DAY);
function cellDate(v) {
  if (typeof v === 'number' && v > 30000 && v < 80000) return serialToIso(v);
  const m = String(v ?? '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const colIndex = (ref) => { let n = 0; for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/**
 * Разобрать старую таблицу посещаемости: на каждом листе строка «№ | ФИО», над ней — дни недели и даты,
 * под датой — 4 колонки (пары 1–4). Отметки: «+», «н», «нб», «нр» (работа), «нз» (заявление).
 * → {weeks: {monday: {ФИО: {iso: {pair: code}}}}, students: [ФИО], marks, sheets}
 */
export async function parseOldXlsx(buf) {
  const files = await unzip(buf);
  const dec = new TextDecoder();
  const shared = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) for (const m of dec.decode(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlUnesc([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join('')));
  const weeks = {}, names = new Set();
  let marks = 0, sheets = 0;
  const sheetNames = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  for (const sn of sheetNames) {
    const grid = new Map(); // row → Map(col → value)
    for (const m of dec.decode(files.get(sn)).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1], inner = m[2] || '';
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      if (!ref) continue;
      const t = (attrs.match(/\bt="(\w+)"/) || [])[1];
      let v = null;
      if (t === 'inlineStr') v = xmlUnesc([...inner.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join(''));
      else {
        const raw = (inner.match(/<v>([^<]*)<\/v>/) || [])[1];
        if (raw == null) continue;
        v = t === 's' ? shared[Number(raw)] : t === 'str' || t === 'b' || t === 'e' ? xmlUnesc(raw) : Number(raw);
      }
      const r = Number(ref.match(/\d+$/)[0]);
      if (!grid.has(r)) grid.set(r, new Map());
      grid.get(r).set(colIndex(ref), v);
    }
    const fioRow = [...grid.keys()].sort((a, b) => a - b).find((r) => String(grid.get(r).get(1) ?? '').trim().toUpperCase() === 'ФИО');
    if (!fioRow) continue;
    // Строка с датами — ближайшая выше «ФИО», где есть даты.
    let dates = [];
    for (let r = fioRow - 1; r >= Math.max(1, fioRow - 4) && !dates.length; r--) {
      dates = [...(grid.get(r) || new Map())].map(([c, v]) => [c, cellDate(v)]).filter(([, d]) => d).sort((a, b) => a[0] - b[0]);
    }
    if (!dates.length) continue;
    sheets++;
    const maxRow = Math.max(...grid.keys());
    for (let r = fioRow + 1; r <= maxRow; r++) {
      const row = grid.get(r);
      const name = row && String(row.get(1) ?? '').replace(/\s+/g, ' ').trim();
      if (!name || name.length < 5) continue;
      names.add(name);
      dates.forEach(([c, iso], i) => {
        const span = Math.min(4, (dates[i + 1] ? dates[i + 1][0] : c + 4) - c);
        for (let k = 0; k < span; k++) {
          const code = oldCode(row.get(c + k));
          if (!code) continue;
          const mon = mondayOf(iso);
          (((weeks[mon] ||= {})[name] ||= {})[iso] ||= {})[k + 1] = code;
          marks++;
        }
      });
    }
  }
  return { weeks, students: [...names], marks, sheets };
}
