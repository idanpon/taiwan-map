import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDateInput, setDateValue } from '../public/date-picker.js';

test('date fields read a day-first date and accept ISO on paste', () => {
  assert.equal(parseDateInput('07.11.2026'), '2026-11-07');
  assert.equal(parseDateInput('7/11/2026'), '2026-11-07');
  assert.equal(parseDateInput('07112026'), '2026-11-07');
  assert.equal(parseDateInput('2026-11-07'), '2026-11-07');
  assert.equal(parseDateInput(' 29.02.2028 '), '2028-02-29');
});

test('date fields distinguish empty values from incomplete and impossible dates', () => {
  assert.equal(parseDateInput('  '), '');
  for (const text of ['07.11.26', '29.02.2026', '31.04.2026', '11.13.2026', '2026-02-30']) {
    assert.equal(parseDateInput(text), null, text);
  }
});

test('writing an ISO date displays day, month and year', () => {
  const input = { setCustomValidity() {}, removeAttribute() {} };
  setDateValue(input, '2026-11-07');
  assert.equal(input.value, '07.11.2026');
  assert.equal(parseDateInput(input.value), '2026-11-07');
});
