import { escapeHtml as esc, icon } from './ui.js';

export function authFormMarkup(mode) {
  const registering = mode === 'register';
  const passwordField = (name, label, autocomplete) => `<div class="auth-field"><label for="auth-${name}">${label}</label><span class="auth-input-row"><input id="auth-${name}" name="${name}" type="password" autocomplete="${autocomplete}" ${registering ? 'minlength="12"' : ''} maxlength="128" required aria-describedby="${registering ? 'password-hint' : 'auth-error'}"><button class="password-toggle" type="button" data-password-toggle="${name}" aria-label="Показать ${name === 'confirm' ? 'повтор пароля' : 'пароль'}" aria-pressed="false">${icon('eye')}</button></span></div>`;
  return `<main class="grades-main auth-main">
    <p class="auth-intro">${registering ? 'Создайте аккаунт для личного кабинета. Администратор подтвердит вашу связь со студентом из списка группы.' : 'Войдите в свой аккаунт, чтобы открыть личный кабинет.'}</p>
    <form class="auth-form" data-auth-form="${mode}">
      <fieldset><legend class="sr-only">${registering ? 'Регистрация' : 'Вход'}</legend>
        ${registering ? '<label class="auth-field"><span>Как к вам обращаться</span><input name="displayName" autocomplete="name" minlength="2" maxlength="80" placeholder="Ваше имя" required></label>' : ''}
        <label class="auth-field"><span>Логин</span><input name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" ${registering ? 'pattern="[A-Za-z0-9][A-Za-z0-9_.\\-]{2,31}" minlength="3"' : ''} maxlength="32" placeholder="${registering ? 'Придумайте логин' : 'Введите логин'}" required ${registering ? 'aria-describedby="username-hint"' : ''}></label>
        ${registering ? '<p class="field-hint" id="username-hint">3–32 символа: латинские буквы, цифры, точка, дефис или подчёркивание.</p>' : ''}
        ${passwordField('password', 'Пароль', registering ? 'new-password' : 'current-password')}
        ${registering ? '<p class="field-hint" id="password-hint">От 12 до 128 символов. Можно использовать длинную фразу.</p>' + passwordField('confirm', 'Повторите пароль', 'new-password') : ''}
        <p class="auth-error" id="auth-error" role="alert" hidden></p>
        <button class="btn auth-submit" type="submit">${registering ? 'Создать аккаунт' : 'Войти'}</button>
      </fieldset>
    </form>
    <p class="auth-switch">${registering ? 'Уже есть аккаунт? <a href="#/login">Войти</a>' : 'Нет аккаунта? <a href="#/register">Зарегистрироваться</a>'}</p>
    ${!registering ? '<p class="field-hint auth-recovery">Восстановление пароля пока не подключено.</p>' : ''}
    <a class="auth-public-link" href="#/schedule">Вернуться к расписанию</a>
  </main>`;
}

export function signedOutMarkup(unavailable = false) {
  return `<main class="grades-main access-main">${icon('user-round')}<h2>Ваши оценки — в личном кабинете</h2><p>Войдите или создайте аккаунт. После подключения журнала здесь появится ваша успеваемость.</p>
    ${unavailable ? '<p class="auth-error" role="status">Сервис входа временно недоступен.</p><button class="btn outline" data-auth-retry>Проверить соединение</button>' : ''}
    <a class="btn auth-submit" href="#/login">Войти в личный кабинет</a><a class="btn outline" href="#/register">Создать аккаунт</a>
    <a class="auth-public-link" href="#/demo">Посмотреть пример журнала</a></main>`;
}

export function profileMarkup(user) {
  const student = user.verifiedStudent && user.student;
  return `<main class="grades-main account-main"><div class="profile-preview">${icon('user-round')}<div><h2>${esc(student ? student.displayName : user.displayName)}</h2><p>@${esc(user.username)}</p></div></div>
    <dl class="profile-facts"><div><dt>Студент</dt><dd>${student ? 'Подтверждён администратором' : 'Ожидает подтверждения'}</dd></div>${student ? `<div><dt>Группа</dt><dd>${esc(student.groupName || 'Не указана')} · ${esc(student.course)} курс</dd></div>` : ''}<div><dt>Оценки</dt><dd>Журнал не подключён</dd></div></dl>
    ${student ? '' : '<p class="field-hint">Сообщите администратору свой логин, чтобы он связал аккаунт с вами в списке группы.</p>'}
    <a class="btn account-cta" href="#/grades">${icon('chart-no-axes-column')} Мои оценки</a>
    <a class="account-settings" href="#/settings">${icon('settings')}<span>Настройки приложения</span>${icon('chevron-right')}</a>
    <p class="auth-error" data-logout-error role="alert" hidden></p>
    <button class="logout-button" data-logout>${icon('log-out')} Выйти из аккаунта</button>
    <p class="demo-notice">Ваши оценки появятся после подключения журнала колледжа.</p></main>`;
}

export function personalGradesMarkup() {
  return `<main class="grades-main access-main">${icon('chart-no-axes-column')}<h2>Журнал ещё не подключён</h2><p>Вы вошли в свой аккаунт. Предметы и оценки появятся после подключения источника данных колледжа.</p><a class="btn" href="#/account">В личный кабинет</a><a class="auth-public-link" href="#/demo">Посмотреть пример журнала</a></main>`;
}
