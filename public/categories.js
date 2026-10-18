// Shared category definitions and Lucide outline paths. License: vendor/lucide-LICENSE.txt.
export const categoryDefinitions=Object.freeze([
 {
  "id": "sight",
  "label": "Достопримечательности",
  "color": "#bb623d",
  "icon": "landmark",
  "description": "Храмы, памятники, архитектура и знаковые туристические объекты.",
  "sort_order": 0
 },
 {
  "id": "culture",
  "label": "Музеи и выставки",
  "color": "#786b9d",
  "icon": "palette",
  "description": "Музеи, галереи, выставочные пространства и инсталляции.",
  "sort_order": 1
 },
 {
  "id": "walks",
  "label": "Районы и прогулки",
  "color": "#527daa",
  "icon": "footprints",
  "description": "Кварталы, улицы, набережные и ночные рынки для прогулок.",
  "sort_order": 2
 },
 {
  "id": "nature",
  "label": "Природа",
  "color": "#65855d",
  "icon": "leaf",
  "description": "Горы, пляжи, озёра, парки, тропы и природные смотровые площадки.",
  "sort_order": 3
 },
 {
  "id": "food",
  "label": "Еда и напитки",
  "color": "#c38331",
  "icon": "utensils",
  "description": "Рестораны, кафе, кофейни, бабл-ти, бары, десерты и стритфуд.",
  "sort_order": 4
 },
 {
  "id": "shopping",
  "label": "Шопинг",
  "color": "#4d8586",
  "icon": "shopping-bag",
  "description": "Магазины, торговые центры, сувениры и рынки для покупок.",
  "sort_order": 5
 },
 {
  "id": "activities",
  "label": "Развлечения и активности",
  "color": "#b15987",
  "icon": "ticket",
  "description": "Горячие источники, аттракционы, мастер-классы и другие развлечения.",
  "sort_order": 6
 },
 {
  "id": "lodging",
  "label": "Жильё",
  "color": "#6d72b4",
  "icon": "bed-double",
  "description": "Отели, апартаменты и другие места проживания.",
  "sort_order": 7
 },
 {
  "id": "transport",
  "label": "Транспорт",
  "color": "#537681",
  "icon": "train-front",
  "description": "Аэропорты, вокзалы, паромные терминалы, пересадки и прокат.",
  "sort_order": 8
 },
 {
  "id": "services",
  "label": "Дела и сервисы",
  "color": "#82705b",
  "icon": "clipboard-check",
  "description": "Билеты, обмен валют, SIM-карты, получение заказов и хранение вещей.",
  "sort_order": 9
 }
].map(Object.freeze));
const aliases=new Map([["cafe", "food"], ["coffee", "food"], ["кофе", "food"], ["кафе", "food"], ["рестораны", "food"], ["еда", "food"], ["museum", "culture"], ["искусство и музеи", "culture"], ["bag", "shopping"]]);
for(const category of categoryDefinitions){aliases.set(category.id,category.id);aliases.set(category.label.toLocaleLowerCase('ru-RU'),category.id)}
export function categoryId(id,label=''){return aliases.get(String(id).trim().toLocaleLowerCase('ru-RU'))||aliases.get(String(label).trim().toLocaleLowerCase('ru-RU'))||null}
const shapes={
 "landmark": "<path d=\"M10 18v-7\" /> <path d=\"M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z\" /> <path d=\"M14 18v-7\" /> <path d=\"M18 18v-7\" /> <path d=\"M3 22h18\" /> <path d=\"M6 18v-7\" />",
 "palette": "<path d=\"M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z\" /> <circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\" /> <circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\" /> <circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\" /> <circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" />",
 "footprints": "<path d=\"M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z\" /> <path d=\"M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z\" /> <path d=\"M16 17h4\" /> <path d=\"M4 13h4\" />",
 "leaf": "<path d=\"M11 20a10 10 0 0010-10 25.9 25.9 0 00-1.04-7.281 1 1 0 00-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0011 20\" /> <path d=\"M2 21a5 5 0 012.911-4.544C7.613 15.212 8.351 15.24 11 13\" />",
 "utensils": "<path d=\"M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2\" /> <path d=\"M7 2v20\" /> <path d=\"M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7\" />",
 "shopping-bag": "<path d=\"M16 10a4 4 0 0 1-8 0\" /> <path d=\"M3.103 6.034h17.794\" /> <path d=\"M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z\" />",
 "ticket": "<path d=\"M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z\" /> <path d=\"M13 5v2\" /> <path d=\"M13 17v2\" /> <path d=\"M13 11v2\" />",
 "bed-double": "<path d=\"M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8\" /> <path d=\"M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4\" /> <path d=\"M12 4v6\" /> <path d=\"M2 18h20\" />",
 "train-front": "<path d=\"M8 3.1V7a4 4 0 0 0 8 0V3.1\" /> <path d=\"m9 15-1-1\" /> <path d=\"m15 15 1-1\" /> <path d=\"M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z\" /> <path d=\"m8 19-2 3\" /> <path d=\"m16 19 2 3\" />",
 "clipboard-check": "<rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\" /> <path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\" /> <path d=\"m9 14 2 2 4-4\" />"
};
export function categoryIcon(name){return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${shapes[name]||shapes.landmark}</svg>`}
