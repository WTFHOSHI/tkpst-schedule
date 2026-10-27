import { escapeHtml as esc, icon } from './ui.js';
import { ATTENDANCE_STATUSES, MIN_MONTH, MAX_MONTH, attendanceModel } from './attendance.js';

const dayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Yekaterinburg' });
const syncFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' });
const gradeNotice = '<section class="attendance-grade-note" role="tabpanel" id="progress-grades" aria-labelledby="progress-grades-tab"><h2>Оценки ещё не подключены</h2><p>Личные оценки появятся после подключения журнала колледжа.</p><a class="auth-public-link" href="#/demo">Посмотреть пример оценок</a></section>';
const retry = '<button class="btn outline" data-attendance-retry>Повторить сейчас</button>';

function missedLabel(count) {
  const lastTwo = count % 100;
  const last = count % 10;
  return `${count} ${lastTwo >= 11 && lastTwo <= 14 ? 'пропусков' : last === 1 ? 'пропуск' : last >= 2 && last <= 4 ? 'пропуска' : 'пропусков'}`;
}

export function attendanceMarkup({ month, tab = 'attendance', kind = 'loading', data, error, refreshError = false }) {
  const activeTab = tab === 'grades' ? 'grades' : 'attendance';
  const tabs = `<div class="progress-tabs" role="tablist" aria-label="Разделы успеваемости"><button type="button" role="tab" id="progress-attendance-tab" aria-controls="progress-attendance" aria-selected="${activeTab === 'attendance'}" data-progress-tab="attendance">Посещаемость</button><button type="button" role="tab" id="progress-grades-tab" aria-controls="progress-grades" aria-selected="${activeTab === 'grades'}" data-progress-tab="grades">Оценки</button></div>`;
  if (activeTab === 'grades') return `<main class="grades-main attendance-main">${tabs}${gradeNotice}</main>`;

  const model = attendanceModel(data, month);
  const controls = `<div class="attendance-month"><button class="icon" data-attendance-prev aria-label="Предыдущий месяц" ${month === MIN_MONTH ? 'disabled' : ''}>${icon('arrow-left')}</button><label><span class="sr-only">Месяц посещаемости</span><input type="month" data-attendance-month value="${esc(month)}" min="${MIN_MONTH}" max="${MAX_MONTH}" required></label><button class="icon" data-attendance-next aria-label="Следующий месяц" ${month === MAX_MONTH ? 'disabled' : ''}>${icon('chevron-right')}</button></div>`;
  let content;
  if (kind === 'loading') {
    content = '<div class="attendance-state" role="status"><div class="spinner small"></div><p>Загружаем посещаемость…</p></div>';
  } else if (kind === 'error') {
    content = `<div class="attendance-state"><h3>Не удалось загрузить посещаемость</h3><p class="auth-error" role="alert">${esc(error || 'Проверьте соединение и попробуйте снова.')}</p>${retry}</div>`;
  } else if (!model.linked) {
    content = '<div class="attendance-state"><h3>Подтвердите связь со студентом</h3><p>Сообщите администратору свой логин. После подтверждения здесь появятся ваши отметки посещаемости.</p><a class="btn outline" href="#/account">Открыть профиль</a></div>';
  } else if (!model.syncedAt) {
    content = '<div class="attendance-state"><h3>Данные за месяц ещё не переданы</h3><p>Посещаемость появится здесь автоматически после передачи отметок из админки. Можно выбрать другой месяц.</p></div>';
  } else {
    const c = model.counts;
    const missedDays = model.days.map(day => ({ date: day.date, records: day.records.filter(record => record.status !== 'P') })).filter(day => day.records.length);
    const summary = c.marked ? `<p class="attendance-overview"><strong>${missedLabel(c.missed)}</strong><span>по отмеченным парам</span></p>` : '';
    const journal = !c.marked
      ? '<div class="attendance-state"><h3>Пока нет отметок</h3><p>В переданных данных за этот месяц нет отметок посещаемости.</p></div>'
      : !missedDays.length
        ? '<div class="attendance-state attendance-empty"><h3>Пропусков нет</h3><p>Среди переданных отметок за этот месяц пропусков нет.</p></div>'
        : `<section class="attendance-journal" aria-label="Список пропусков"><ul class="attendance-absence-list">${missedDays.map(day => `<li class="attendance-absence-day"><h3><time datetime="${day.date}">${esc(dayFormat.format(new Date(day.date + 'T12:00:00Z')))}</time></h3><ul>${day.records.map(record => `<li><span>${record.pair}-я пара</span><span class="attendance-status ${record.status === 'N' ? 'is-unexcused' : ''}">${esc(ATTENDANCE_STATUSES[record.status])}</span></li>`).join('')}</ul></li>`).join('')}</ul></section>`;
    content = `${summary}${journal}<p class="attendance-caption">Пустые ячейки не считаются пропусками.</p><div class="attendance-sync"><p>Последняя передача: <time datetime="${esc(model.syncedAt)}">${esc(syncFormat.format(new Date(model.syncedAt)))}</time> · Тюмень</p><p>Обновляется автоматически</p></div>${refreshError ? '<p class="attendance-refresh-error" role="status">Не удалось проверить новые отметки. Повторим автоматически.</p>' : ''}`;
  }
  return `<main class="grades-main attendance-main">${tabs}<section role="tabpanel" id="progress-attendance" aria-labelledby="progress-attendance-tab"><h2 class="sr-only">Посещаемость</h2>${controls}<div data-attendance-content aria-live="polite" aria-busy="${kind === 'loading'}">${content}</div></section></main>`;
}
