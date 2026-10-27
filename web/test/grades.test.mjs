import test from 'node:test';
import assert from 'node:assert/strict';
import { average, subjectsForSemester, findSubject, semesterAverage } from '../js/grades.js';

test('средний балл считается по оценкам, пустые данные не превращаются в ноль', () => {
  assert.equal(average([5, 4, 5, 4, 5]), 4.6);
  assert.equal(average([]), null);
  assert.equal(semesterAverage('2026-1'), 4.4);
});

test('у пустого семестра нет предметов и среднего балла', () => {
  assert.deepEqual(subjectsForSemester('2026-2'), []);
  assert.equal(semesterAverage('2026-2'), null);
  assert.deepEqual(subjectsForSemester('unknown'), []);
});

test('история относится только к выбранному предмету и семестру', () => {
  const subject = findSubject('2026-1', 'mobile');
  assert.equal(subject.title, 'Разработка мобильных приложений');
  assert.deepEqual(subject.grades.map(g => g.value), [5, 4, 5, 4, 5]);
  assert.equal(findSubject('2026-2', 'mobile'), null);
  assert.equal(findSubject('2026-1', 'missing'), null);
  assert.equal(findSubject('2026-1', '__proto__'), null);
});
