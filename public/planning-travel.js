export const transportModes = {
  plane: 'Самолёт',
  train: 'Поезд',
  bus: 'Автобус',
  car: 'Автомобиль',
  ship: 'Водный транспорт',
  cable_car: 'Канатная дорога',
  other: 'Другое',
};

export const isTravel = kind => kind === 'stay' || kind === 'transport';

export const travelPlace = (item, role) => item.places.find(place => place.role === role);

export function stayPhase(item, day) {
  if (day === item.date_start) return 'Заселение';
  if (day === item.date_end) return 'Выезд';
  return 'Проживание';
}

export function coversNight(item, day) {
  return item.kind === 'stay' && item.state !== 'cancelled' &&
    item.date_start <= day && day < item.date_end;
}
