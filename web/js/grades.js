// Synthetic preview only. Real student data will come from an authenticated API.
const rows = [
  ['mobile', 'Разработка мобильных приложений', [5, 4, 5, 4, 5]],
  ['design', 'Графический дизайн и мультимедиа', [5, 5, 4, 5, 5]],
  ['math', 'Математика', [4, 4, 5, 4, 5]],
  ['english', 'Иностранный язык', [4, 5, 4, 4, 4]],
  ['sport', 'Физическая культура', [4, 4, 4, 4, 4]],
];
const dates = ['2026-10-12', '2026-10-15', '2026-10-19', '2026-10-22', '2026-10-26'];
const kinds = ['Практическая работа', 'Работа на занятии', 'Самостоятельная работа', 'Практическая работа', 'Контрольная работа'];
const subjects = rows.map(([id, title, values]) => ({
  id, title, grades: values.map((value, i) => ({ value, date: dates[i], kind: kinds[i] })),
}));

export const semesters = [
  { id: '2026-1', label: '1 семестр 2026/27' },
  { id: '2026-2', label: '2 семестр 2026/27' },
];

export function average(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null;
}
export function subjectsForSemester(id) { return id === '2026-1' ? subjects : []; }
export function findSubject(semester, id) { return subjectsForSemester(semester).find(s => s.id === id) || null; }
export function semesterAverage(id) { return average(subjectsForSemester(id).flatMap(s => s.grades.map(g => g.value))); }
export function formatGrade(value) { return value == null ? '—' : value.toFixed(1).replace('.', ','); }
