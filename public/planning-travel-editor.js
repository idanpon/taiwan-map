import { validDate } from './planning-model.js';
import { zoneOptions } from './planning-time-ui.js';
import { dateInput, dateValue } from './date-picker.js';
import { isTravel, transportModes, travelPlace } from './planning-travel.js';
import { civil, localInstants, offsetLabel, pointInZone, validClock } from './trip-timezones.js';

export function travelItemEditor(item, plan, esc) {
  const transport = item.transport ?? {};
  const stay = travelPlace(item, 'lodging');
  const departureZone = isTravel(item.kind) || item.starts_at
    ? item.event_timezone : plan.trip.timezone || 'Asia/Taipei';
  const arrivalZone = transport.arrival_timezone || departureZone;
  const zones = zoneOptions([{ zone: departureZone }, { zone: arrivalZone }], esc);
  const removedPlace = '__removed__';
  const placeOptions = plan.places.map(place =>
    `<option value="${esc(place.id)}">${esc(place.name)} · ${esc(place.city)}${place.hidden?' · скрыто':''}</option>`
  ).join('');
  const sides = [
    { key: 'departure', day: item.date_start || item.date_end, instant: item.starts_at, zone: departureZone },
    { key: 'arrival', day: item.date_end, instant: item.ends_at, zone: arrivalZone },
  ];
  for (const side of sides) {
    const clock = side.instant ? civil(side.instant, side.zone) : null;
    side.day = clock?.day || side.day;
    side.time = clock?.time || '';
  }
  const field = (name, value, max, required = false) =>
    `<input class="ui-field ui-field--soft" name="${name}" value="${esc(value ?? '')}" maxlength="${max}" ${required?'required':''}>`;
  const endpointHtml = side => {
    const { key, day, time } = side;
    const link = travelPlace(item, key);
    return `<div class="travel-editor-endpoint" data-travel-side="${key}">
      <h3 data-travel-side-title></h3>
      <fieldset data-transport-only class="travel-editor-places">
        <label>Название точки${field(key+'_name',link?.place_name,200,true)}</label>
        <label>Место на карте (необязательно)<select class="ui-field ui-field--soft" name="${key}_place"><option value="">Текстовая точка</option>${placeOptions}</select></label>
      </fieldset>
      <div class="form-columns">
        ${dateInput(key+'_date',day,'Дата')}
        <label>Время (если известно)<input class="ui-field ui-field--soft" type="time" name="${key}_clock" value="${esc(time)}"></label>
      </div>
      <label ${key==='arrival'?'data-arrival-zone':''}>Часовой пояс<select class="ui-field ui-field--soft" name="${key}_zone" required>${zones}</select></label>
      <div data-travel-offset></div>
    </div>`;
  };
  const html = `<fieldset class="planning-travel-editor ui-fieldset" data-travel-editor hidden disabled>
    <legend data-travel-legend>Даты и места</legend>
    <fieldset data-stay-only class="travel-editor-places">
      <label>Место проживания<select class="ui-field ui-field--soft" name="lodging_place" required><option value="">Выберите место на карте</option>
        ${stay&&!stay.place_id?`<option value="${removedPlace}">${esc(stay.place_name)} · место удалено</option>`:''}${placeOptions}</select></label>
      <p class="muted">Одна запись на всю подтверждённую бронь.</p>
    </fieldset>
    <fieldset data-transport-only class="travel-editor-places"><label>Вид транспорта<select class="ui-field ui-field--soft" name="transport_mode" required>
      <option value="">Выберите вид транспорта</option>${Object.entries(transportModes).map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join('')}</select></label></fieldset>
    ${sides.map(endpointHtml).join('')}
    <fieldset data-transport-only class="travel-editor-places"><details>
      <summary>Номер, терминалы и остановки</summary>
      <label>Номер рейса, поезда или маршрута${field('service_number',transport.service_number,100)}</label>
      <label>Терминал / платформа отправления${field('departure_details',transport.departure_details,300)}</label>
      <label>Терминал / платформа прибытия${field('arrival_details',transport.arrival_details,300)}</label>
      <label>Промежуточные остановки, по одной на строку<textarea class="ui-field ui-field--soft" name="transport_stops" maxlength="6030">${esc((transport.stops||[]).join('\n'))}</textarea></label>
    </details></fieldset>
    <details>
      <summary>Зависимости от других записей</summary>
      <ul class="ui-list" data-travel-deps></ul>
      <label>Связать с задачей, решением или другим событием<select class="ui-field ui-field--soft" name="travel_dependency">
        <option value="">Выберите запись</option>${plan.items.filter(other=>other.id!==item.id).map(other=>`<option value="${esc(other.id)}">${esc(other.title)}</option>`).join('')}
      </select></label>
      <button type="button" class="ui-button ui-button--quiet ui-button--compact" data-travel-dep-add>＋ Связать</button>
    </details>
  </fieldset>`;
  const dependencies = new Set(item.dependencies);
  let controls, panel, kind;
  function redrawTime(side) {
    const { key } = side, zone = controls[kind==='stay'?'departure_zone':key+'_zone'].value;
    const day = dateValue(controls[key+'_date']), time = controls[key+'_clock'].value;
    const box = panel.querySelector('[data-travel-side="'+key+'"] [data-travel-offset]');
    const picked = box.querySelector('select')?.value;
    box.replaceChildren();
    controls[key+'_clock'].setCustomValidity('');
    side.selected = null;
    if (!isTravel(kind) || !validDate(day) || !validClock(time) || !zone) return;
    if (side.instant && day===side.day && time===side.time && zone===side.zone) {
      side.selected = side.instant;
      return;
    }
    const candidates = localInstants(day,time,zone);
    if (candidates.length === 1) {
      side.selected = new Date(candidates[0]).toISOString();
    } else if (candidates.length) {
      const label = document.createElement('label'), select = document.createElement('select');
      label.textContent = 'Время повторяется. Уточните смещение UTC';
      select.className = 'ui-field ui-field--soft';
      select.required = true;
      select.add(new Option('Выберите смещение',''));
      for (const at of candidates) select.add(new Option(offsetLabel(pointInZone(at,zone).offset),String(at)));
      if (candidates.map(String).includes(picked)) select.value = picked;
      select.oninput = () => { side.selected = select.value ? new Date(Number(select.value)).toISOString() : null; };
      select.oninput();
      label.append(select);
      box.append(label);
    } else {
      controls[key+'_clock'].setCustomValidity('Такого местного времени нет. Укажите другое.');
      box.innerHTML = '<p class="planning-warning">Такого местного времени нет. Укажите другое.</p>';
    }
  }
  function sync(nextKind) {
    kind = nextKind;
    panel.hidden = panel.disabled = !isTravel(kind);
    const lodging = kind === 'stay';
    panel.querySelector('[data-travel-legend]').textContent = lodging ? 'Бронь' : 'Маршрут';
    for (const field of panel.querySelectorAll('[data-transport-only]'))
      field.hidden = field.disabled = lodging;
    for (const field of panel.querySelectorAll('[data-stay-only]'))
      field.hidden = field.disabled = !lodging;
    controls.arrival_zone.disabled = lodging;
    panel.querySelector('[data-arrival-zone]').hidden = lodging;
    const titles = lodging ? ['Заселение','Выезд'] : ['Отправление','Прибытие'];
    panel.querySelectorAll('[data-travel-side-title]').forEach((title,index)=>{title.textContent=titles[index]});
    for (const side of sides) redrawTime(side);
  }
  function mount(form, initialKind) {
    panel = form.querySelector('[data-travel-editor]');
    controls = form.elements;
    controls.lodging_place.value = stay?.place_id || (stay ? removedPlace : '');
    controls.transport_mode.value = transport.mode || '';
    for (const side of sides) {
      const { key } = side, select = controls[key+'_place'], name = controls[key+'_name'];
      controls[key+'_zone'].value = side.zone;
      controls[key+'_date'].required = true;
      select.value = travelPlace(item,key)?.place_id || '';
      select.onchange = () => {
        const place = plan.places.find(place=>place.id===select.value);
        if (!name.value.trim() && place) name.value = place.name;
      };
      for (const suffix of ['_date','_clock','_zone']) controls[key+suffix].addEventListener('input', () => {
        redrawTime(side);
        if (kind==='stay' && key==='departure' && suffix==='_zone') redrawTime(sides[1]);
      });
    }
    const list = panel.querySelector('[data-travel-deps]');
    const redraw = () => {
      list.innerHTML = [...dependencies].map(id=>{
        const title = plan.items.find(other=>other.id===id)?.title || id;
        return `<li class="travel-dependency-row"><span>${esc(title)}</span><button type="button" class="ui-button ui-button--quiet ui-button--compact" data-travel-dep-remove="${esc(id)}" aria-label="Убрать связь с ${esc(title)}">Убрать</button></li>`;
      }).join('');
    };
    panel.querySelector('[data-travel-dep-add]').onclick = () => {
      if (!controls.travel_dependency.value) return;
      dependencies.add(controls.travel_dependency.value);
      controls.travel_dependency.value = '';
      form.dispatchEvent(new Event('input',{bubbles:true}));
      redraw();
    };
    list.onclick = event => {
      const button = event.target.closest('[data-travel-dep-remove]');
      if (!button) return;
      dependencies.delete(button.dataset.travelDepRemove);
      form.dispatchEvent(new Event('input',{bubbles:true}));
      redraw();
    };
    redraw();
    sync(initialKind);
  }
  function values() {
    const [start,end] = sides;
    const from = dateValue(controls.departure_date), to = dateValue(controls.arrival_date);
    const lodging = kind === 'stay';
    if (!from || !to) throw new Error(lodging ? 'Укажите даты заселения и выезда.' : 'Укажите даты отправления и прибытия.');
    if (lodging && from >= to) throw new Error('Дата выезда должна быть позже даты заселения.');
    if (sides.some(side=>controls[side.key+'_clock'].value&&!side.selected))
      throw new Error('Уточните выбранное местное время.');
    const dates = { date_start: from, date_end: to, starts_at: start.selected, ends_at: end.selected,
      event_timezone: controls.departure_zone.value };
    const common = { ...dates, dependencies: [...dependencies] };
    if (lodging) {
      const id = controls.lodging_place.value;
      return { ...common, places: [id===removedPlace?stay:{role:'lodging',place_id:id}] };
    }
    return {
      ...common,
      places: sides.map(({key})=>({role:key,place_name:controls[key+'_name'].value,place_id:controls[key+'_place'].value||null})),
      transport: {
        mode: controls.transport_mode.value, arrival_timezone: controls.arrival_zone.value,
        service_number: controls.service_number.value,
        departure_details: controls.departure_details.value, arrival_details: controls.arrival_details.value,
        stops: controls.transport_stops.value.split('\n').map(value=>value.trim()).filter(Boolean),
      },
    };
  }
  return { html, mount, sync, values };
}
