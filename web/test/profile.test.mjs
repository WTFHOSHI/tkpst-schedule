import test from 'node:test';
import assert from 'node:assert/strict';
import { profileMarkup } from '../js/auth-view.js';
test('verified profile uses own directory name and group, unlinked profile explains confirmation', () => {
  const html = profileMarkup({ username: 'one', displayName: 'Имя регистрации', verifiedStudent: true, student: { displayName: 'ФИО <студента>', groupName: 'ИС-25-3С', course: '2' } });
  assert.match(html, /ФИО &lt;студента&gt;/); assert.match(html, /ИС-25-3С/); assert.match(html, /Подтверждён/);
  assert.match(profileMarkup({ username: 'two', displayName: 'Имя', verifiedStudent: false }), /Ожидает подтверждения/);
});
