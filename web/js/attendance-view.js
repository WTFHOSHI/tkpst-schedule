import { escapeHtml as esc, icon } from './ui.js';
import { ATTENDANCE_STATUSES, MIN_MONTH, MAX_MONTH, attendanceModel, monthLabel } from './attendance.js';

const dayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Yekaterinburg' });
const syncFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' });
const gradeNotice = '<section class="attendance-grade-note"><h2>Оценки ещё не подключены</h2><p>Личные оценки появятся после подключения журнала колледжа.</p><a class="auth-public-link" href="#/demo">Посмотреть пример оценок</a></section>';
const retry = '<button class="btn outline" data-attendance-retry>Обновить данные</button>';

export function attendanceMarkup({ month, kind = 'loading', data, error }) {
  const model = attendanceModel(data, month);
  const controls = `<div class="attendance-month"><button class="icon" data-attendance-prev aria-label="Предыдущий месяц" ${month === MIN_MONTH ? 'disabled' : ''}>${icon('arrow-left')}</button><label><span class="sr-only">Месяц посещаемости</span><input type="month" data-attendance-month value="${esc(month)}" min="${MIN_MONTH}" max="${MAX_MONTH}" required aria-describedby="attendance-month-label"></label><button class="icon" data-attendance-next aria-label="Следующий месяц" ${month === MAX_MONTH ? 'disabled' : ''}>${icon('chevron-right')}</button></div><p class="attendance-month-label" id="attendance-month-label">${esc(monthLabel(month))}</p>`;
  let content;
  if (kind === 'loading') {
    content = '<div class="attendance-state" role="status"><div class="spinner small"></div><p>Загружаем посещаемость…</p></div>';
  } else if (kind === 'error') {
    content = `<div class="attendance-state"><h3>Не удалось загрузить посещаемость</h3><p class="auth-error" role="alert">${esc(error || 'Проверьте соединение и попробуйте снова.')}</p>${retry}</div>`;
  } else if (!model.linked) {
    content = '<div class="attendance-state"><h3>Подтвердите связь со студентом</h3><p>Сообщите администратору свой логин. После подтверждения здесь появятся ваши отметки посещаемости.</p><a class="btn outline" href="#/account">Открыть профиль</a></div>';
  } else if (!model.syncedAt) {
    content = `<div class="attendance-state"><h3>Данные за месяц ещё не переданы</h3><p>Администратор ещё не передал посещаемость за выбранный месяц. Можно выбрать другой месяц или проверить позже.</p>${retry}</div>`;
  } else {
    const c = model.counts;
    const summary = c.marked ? `<dl class="attendance-summary" aria-label="По отмеченным парам"><div><dt>Был на парах</dt><dd>${c.attended}</dd></div><div><dt>Пропущено пар</dt><dd>${c.missed}</dd></div><div><dt>Из них прогулов</dt><dd>${c.unexcused}</dd></div></dl><p class="attendance-caption">Только по отмеченным парам: ${c.marked}.</p>` : '';
    const reasons = c.marked ? `<details class="attendance-reasons"><summary>Причины пропусков · ${c.missed}</summary><dl>${['N', 'B', 'U', 'R', 'Z'].map(status => `<div><dt>${ATTENDANCE_STATUSES[status]}</dt><dd>${c[status]}</dd></div>`).join('')}</dl></details>` : '';
    const journal = c.marked ? `<section class="attendance-journal" aria-labelledby="attendance-journal-title"><h2 id="attendance-journal-title">Журнал посещаемости</h2>${model.days.map(day => `<section class="attendance-day"><h3><time datetime="${day.date}">${esc(dayFormat.format(new Date(day.date + 'T12:00:00Z')))}</time></h3><ul>${day.records.map(record => `<li><span>${record.pair}-я пара</span><span class="attendance-status ${record.status === 'P' ? 'is-present' : record.status === 'N' ? 'is-unexcused' : ''}">${ATTENDANCE_STATUSES[record.status]}</span></li>`).join('')}</ul></section>`).join('')}</section>` : '<div class="attendance-state"><h3>Пока нет отметок</h3><p>В переданных данных за этот месяц нет отметок посещаемости.</p></div>';
    content = `${summary}${reasons}${journal}<p class="attendance-caption">Пустые ячейки не считаются пропусками. Показаны только переданные отметки.</p><div class="attendance-sync"><p>Последняя передача: <time datetime="${esc(model.syncedAt)}">${esc(syncFormat.format(new Date(model.syncedAt)))}</time> · Тюмень</p><button class="attendance-refresh" data-attendance-retry>Обновить</button></div><p class="attendance-caption">Изменения появятся после следующей передачи данных администратором.</p>`;
  }
  return `<main class="grades-main attendance-main"><section aria-labelledby="attendance-title"><h2 id="attendance-title">Посещаемость</h2>${controls}<div data-attendance-content aria-live="polite" aria-busy="${kind === 'loading'}">${content}</div></section>${gradeNotice}</main>`;
}
