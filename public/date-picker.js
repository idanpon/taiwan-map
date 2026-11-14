import { escapeHtml as esc } from './client-runtime.js';
import { addDays, dayInZone, monthDays, validDate } from './planning-model.js';
import { installDialogBackdrop } from './dialogs.js';

const firstDate = '0001-01-01', lastDate = '9999-12-31';
const monthLabel = new Intl.DateTimeFormat('ru-RU', {month:'long',year:'numeric',timeZone:'UTC'});
const fullDateLabel = new Intl.DateTimeFormat('ru-RU', {dateStyle:'full',timeZone:'UTC'});
const weekdays = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
// Lucide calendar icon.
const calendarIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2v4m8-4v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/></svg>';
let nextId = 0;

const supportedDate = value => validDate(value) && value >= firstDate && value <= lastDate;
const atNoon = date => new Date(date+'T12:00:00Z');

export function parseDateInput(value) {
  const text = value.trim();
  if (!text || supportedDate(text)) return text;
  const parts = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text) || /^(\d{2})(\d{2})(\d{4})$/.exec(text);
  if (!parts) return null;
  const [, day, month, year] = parts;
  const date = year+'-'+month.padStart(2,'0')+'-'+day.padStart(2,'0');
  return supportedDate(date) ? date : null;
}

export function dateValue(input) {
  return parseDateInput(input.value);
}

function displayDate(date) {
  return supportedDate(date) ? date.split('-').reverse().join('.') : date || '';
}

function validate(input) {
  const date = dateValue(input);
  const problem = date === null ? 'Укажите существующую дату в формате ДД.ММ.ГГГГ.'
    : date === '' && input.required && input.value !== '' ? 'Укажите дату.' : '';
  input.setCustomValidity(problem);
  if (!problem) input.removeAttribute('aria-invalid');
  return !problem;
}

export function setDateValue(input, date) {
  input.value = displayDate(date);
  validate(input);
}

export function dateInput(name, value, label) {
  const id = 'ui-date-'+(++nextId);
  return `<div class="ui-date-control">
  <label id="${id}-label" for="${id}">${esc(label)}</label>
  <div class="ui-field-group ui-field-group--soft ui-date-field">
    <input id="${id}" name="${esc(name)}" type="text" data-date-input value="${esc(displayDate(value))}"
      inputmode="numeric" autocomplete="off" placeholder="ДД.ММ.ГГГГ" title="День, месяц, год">
    <button type="button" class="ui-button ui-button--quiet ui-button--icon" data-date-picker
      aria-label="Открыть календарь" aria-describedby="${id}-label" aria-haspopup="dialog">${calendarIcon}</button>
  </div>
</div>`;
}

function shiftMonth(date, amount) {
  const target = atNoon(date.slice(0,7)+'-01');
  target.setUTCMonth(target.getUTCMonth()+amount);
  if (target.getUTCFullYear()<1 || target.getUTCFullYear()>9999) return date;
  const month = target.toISOString().slice(0,7);
  target.setUTCMonth(target.getUTCMonth()+1,0);
  const number = Math.min(Number(date.slice(8)),target.getUTCDate());
  return month+'-'+String(number).padStart(2,'0');
}

export function installDatePicker(document, {today=()=>dayInZone()}={}) {
  let picker, input, cursor, current;
  function render() {
    const selected = dateValue(input);
    const month = cursor.slice(0,7), days = monthDays(cursor);
    picker.querySelector('.ui-date-month').textContent = monthLabel.format(atNoon(cursor));
    picker.querySelector('[data-date-step="-1"]').disabled = month==='0001-01';
    picker.querySelector('[data-date-step="1"]').disabled = month==='9999-12';
    picker.querySelector('[data-date-clear]').hidden = input.required;
    let rows = '';
    for (let i=0; i<days.length; i+=7) {
      rows += '<tr>'+days.slice(i,i+7).map(day => {
        if (!supportedDate(day)) return '<td></td>';
        const pressed = day===selected, isToday=day===current;
        return `<td aria-selected="${pressed}"><button type="button" class="ui-button ui-button--quiet ui-date-day${day.startsWith(month)?'':' ui-date-other-month'}"
          data-date-day="${day}" tabindex="${day===cursor?0:-1}" aria-label="${esc(fullDateLabel.format(atNoon(day)))}"
          ${isToday?'aria-current="date"':''}>${Number(day.slice(8))}</button></td>`;
      }).join('')+'</tr>';
    }
    picker.querySelector('tbody').innerHTML = rows;
  }

  function moveTo(date, focus=false) {
    if (!supportedDate(date)) return;
    cursor = date;
    render();
    if (focus) picker.querySelector('[data-date-day][tabindex="0"]').focus({preventScroll:true});
  }

  function choose(date) {
    const field = input;
    const previous = dateValue(field);
    setDateValue(field,date);
    picker.close();
    if (date!==previous) {
      const Event = document.defaultView.Event;
      field.dispatchEvent(new Event('input',{bubbles:true}));
      field.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }

  function createPicker() {
    const dialog = document.createElement('dialog');
    dialog.className = 'ui-panel ui-overlay ui-dialog ui-date-picker';
    dialog.setAttribute('aria-labelledby','ui-date-picker-title');
    dialog.innerHTML = `<div class="ui-overlay-heading">
      <h2 class="ui-overlay-title" id="ui-date-picker-title">Выбрать дату</h2>
      <button type="button" class="ui-overlay-close ui-button ui-button--quiet ui-button--icon"
        data-date-close aria-label="Закрыть календарь">×</button>
    </div><div class="ui-overlay-body">
      <div class="ui-date-navigation">
        <button type="button" class="ui-button ui-button--quiet ui-button--icon" data-date-step="-1" aria-label="Предыдущий месяц">‹</button>
        <h3 id="ui-date-month" class="ui-date-month" aria-live="polite"></h3>
        <button type="button" class="ui-button ui-button--quiet ui-button--icon" data-date-step="1" aria-label="Следующий месяц">›</button>
      </div>
      <table class="ui-date-days" role="grid" aria-labelledby="ui-date-month">
        <thead><tr>${weekdays.map(day=>`<th scope="col">${day}</th>`).join('')}</tr></thead><tbody></tbody>
      </table>
      <div class="ui-date-footer ui-button-group">
        <button type="button" class="ui-button ui-button--quiet ui-button--compact" data-date-today>Сегодня</button>
        <button type="button" class="ui-button ui-button--quiet ui-button--compact" data-date-clear>Очистить</button>
      </div>
    </div>`;
    dialog.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-date-close')) dialog.close();
      else if (button.dataset.dateStep) {
        moveTo(shiftMonth(cursor,Number(button.dataset.dateStep)));
        if (button.disabled) picker.querySelector('[data-date-day][tabindex="0"]').focus({preventScroll:true});
      } else if (button.hasAttribute('data-date-today')) choose(current);
      else if (button.hasAttribute('data-date-clear')) choose('');
      else if (button.dataset.dateDay) choose(button.dataset.dateDay);
    });
    dialog.addEventListener('keydown', event => {
      const day = event.target.dataset.dateDay;
      if (!day || event.altKey || event.ctrlKey || event.metaKey) return;
      const offsets = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
      const weekday = (atNoon(day).getUTCDay()+6)%7;
      let target;
      if (event.key in offsets) target = addDays(day,offsets[event.key]);
      else if (event.key==='Home') target = addDays(day,-weekday);
      else if (event.key==='End') target = addDays(day,6-weekday);
      else if (event.key==='PageUp') target = shiftMonth(day,event.shiftKey?-12:-1);
      else if (event.key==='PageDown') target = shiftMonth(day,event.shiftKey?12:1);
      else return;
      event.preventDefault();
      moveTo(target,true);
    });
    installDialogBackdrop(dialog);
    dialog.addEventListener('close', () => { if (!dialog.open) input = null; });
    document.body.append(dialog);
    return dialog;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-date-picker]');
    if (!button) return;
    input = button.parentElement.querySelector('[data-date-input]');
    if (input.matches(':disabled')) return;
    picker ||= createPicker();
    current = today();
    cursor = dateValue(input) || current;
    render();
    button.focus({preventScroll:true});
    picker.showModal();
    picker.querySelector('[data-date-day][tabindex="0"]').focus({preventScroll:true});
  });
  document.addEventListener('input', event => {
    if (event.target.matches?.('[data-date-input]')) validate(event.target);
  },true);
  document.addEventListener('focusout', event => {
    const field = event.target;
    if (!field.matches?.('[data-date-input]')) return;
    if (validate(field)) field.value = displayDate(dateValue(field));
    else field.setAttribute('aria-invalid','true');
  });
  document.addEventListener('invalid', event => {
    if (event.target.matches?.('[data-date-input]')) event.target.setAttribute('aria-invalid','true');
  },true);

  return () => picker?.close();
}
