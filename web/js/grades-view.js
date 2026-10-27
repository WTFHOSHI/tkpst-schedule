import { average, formatGrade, subjectsForSemester, semesterAverage, semesters, findSubject } from './grades.js';
import { escapeHtml as esc, icon } from './ui.js';

const chips = (grades) => grades.map(g => `<span class="grade-chip ${g.value === 5 ? 'excellent' : ''}">${g.value}</span>`).join('');
const demoNote = '<p class="demo-foot">Пример оценок · 26 октября 2026</p>';

export function gradesMarkup(semester, subjectBase = 'subject') {
  const subjects = subjectsForSemester(semester);
  return `<main class="grades-main">
    <label class="semester-select"><span class="sr-only">Учебный семестр</span><select data-semester>${semesters.map(s => `<option value="${s.id}" ${s.id === semester ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
    <section class="grade-summary" aria-label="Средний балл за семестр"><div><strong>${formatGrade(semesterAverage(semester))}</strong><span>Средний балл</span></div><p>Демонстрационные<br>данные</p></section>
    <section class="subjects-section" aria-labelledby="subjects-title"><h2 id="subjects-title">Предметы</h2>
      ${subjects.length ? `<div class="subject-columns"><span>Последние оценки</span><span>Средний балл</span></div><div class="subject-list">${subjects.map(s => `<a class="subject-row" href="#/${subjectBase}/${s.id}" aria-label="${esc(s.title)}, средний балл ${formatGrade(average(s.grades.map(g => g.value)))}"><div class="subject-content"><h3>${esc(s.title)}</h3><div class="grade-chips" aria-label="Последние оценки">${chips(s.grades)}</div></div><strong class="subject-average">${formatGrade(average(s.grades.map(g => g.value)))}</strong>${icon('chevron-right')}</a>`).join('')}</div>`
        : '<div class="empty-grades"><h3>Оценок пока нет</h3><p>В этом семестре ещё нет демонстрационных оценок.</p><button class="btn" data-first-semester>К первому семестру</button></div>'}
    </section>${demoNote}
  </main>`;
}

export function subjectMarkup(semester, id) {
  const subject = findSubject(semester, id);
  if (!subject) return '<main class="list"><div class="msg"><h2>Предмет не найден</h2><a class="btn" href="#/grades">К предметам</a></div></main>';
  return `<main class="grades-main subject-detail"><p class="detail-subject">${esc(subject.title)}</p><div class="detail-summary"><span>Средний балл за семестр</span><strong>${formatGrade(average(subject.grades.map(g => g.value)))}</strong></div><h2>История оценок</h2><div class="grade-history">${[...subject.grades].reverse().map(g => `<article class="history-row"><div><h3>${esc(g.kind)}</h3><time datetime="${g.date}">${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Yekaterinburg' }).format(new Date(g.date + 'T12:00:00+05:00'))}</time></div><span class="grade-chip ${g.value === 5 ? 'excellent' : ''}" aria-label="Оценка ${g.value}">${g.value}</span></article>`).join('')}</div><p class="demo-notice">Это пример журнала. Реальные оценки появятся после подключения журнала колледжа.</p></main>`;
}
