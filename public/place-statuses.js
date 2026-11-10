export const placeStatusIds = ['want', 'maybe', 'visited'];

export const defaultPlaceStatuses = [
  { id: 'want', label: 'Хотим посетить', color: '#1456e0', symbol: '!', dimmed: false },
  { id: 'visited', label: 'Уже посетили', color: '#6b7280', symbol: '✓', dimmed: true },
  { id: 'maybe', label: 'Под вопросом', color: '#facc15', symbol: '?', dimmed: false },
];

export function fixedPlaceStatuses(statuses) {
  return statuses.filter(status => placeStatusIds.includes(status.id));
}
