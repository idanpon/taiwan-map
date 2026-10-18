import {categoryDefinitions,categoryIcon} from './categories.js';
import {statusAppearance} from './map-model.js';

export function helpContent(data,esc){
 const categories=data.categories.map(category=>{
  const description=category.description||categoryDefinitions.find(c=>c.id===category.id)?.description||'Тип места на карте.';
  return `<li><span class="help-category-icon" style="color:${esc(category.color)}" aria-hidden="true">${categoryIcon(category.icon)}</span><div><strong>${esc(category.label)}</strong><p>${esc(description)}</p></div></li>`;
 }).join('');
 const statuses=data.statuses.map(status=>{
  const view=statusAppearance(status);
  return `<li><i class="status-dot" style="--status:${view.color};--status-symbol:${view.symbolColor};--status-opacity:${view.opacity}" aria-hidden="true">${esc(view.symbol)}</i><div><strong>${esc(view.label)}</strong><p>${view.dimmed?'Полупрозрачный маркер.':'Обычная непрозрачность маркера.'}</p></div></li>`;
 }).join('');
 return `<p class="help-intro">Интерактивная карта интересных мест для путешествия. Здесь можно находить достопримечательности, рестораны, магазины и другие точки, смотреть подробности и отслеживать планы посещения.</p>
 <section aria-labelledby="help-categories-title"><h3 id="help-categories-title">Категории мест</h3><ul class="help-categories">${categories}</ul></section>
 <section aria-labelledby="help-statuses-title"><h3 id="help-statuses-title">Статусы мест</h3><p>Названия, цвета, символы и полупрозрачность статусов задают участники с правами редактирования. Их смысл определяется вашей договорённостью, а не встроенным названием. Ниже — текущие статусы карты; после переименования или удаления список обновится при открытии справки.</p>${statuses?`<ul class="help-statuses">${statuses}</ul>`:"<p>На карте пока нет статусов.</p>"}<p>Большой маркер обозначает категорию места, маленький цветной кружок — его статус. Статусы и заметки общие для участников поездки.</p></section>
 <section aria-labelledby="help-map-title"><h3 id="help-map-title">Работа с картой</h3><ol><li>Перемещайте карту и меняйте масштаб, чтобы изучать разные районы.</li><li>Нажимайте на маркеры или места в списке, чтобы открыть подробную информацию.</li><li>Фильтруйте места по городу, категории и статусу. Можно выбрать несколько категорий.</li><li>Нажмите «Сбросить», чтобы отменить все фильтры, включая поиск.</li><li>В карточке места доступны описание, заметка, часы работы и ссылки на Google Maps и другие источники.</li></ol><p>${data.user?.role==='viewer'?'У вас доступ для просмотра: менять общие статусы и заметки нельзя.':'Статус и заметку можно изменить в карточке места и сохранить. Кнопка ⚙ рядом с фильтром статусов открывает их настройки. Место можно скрыть или удалить из его карточки. Раздел «Скрытые места» над списком позволяет вернуть его на карту или удалить навсегда. Удаление убирает место, заметки и историю с сервера, отменить его в приложении нельзя.'}</p></section>
 <section class="help-notice" aria-labelledby="help-add-title"><h3 id="help-add-title">Как добавить или изменить место</h3><p>В текущей версии добавление новых мест и изменение описаний, адресов и координат выполняются только через управляющий аккаунт ChatGPT. Самостоятельное добавление мест через интерфейс сайта пока недоступно.</p></section>
 <section aria-labelledby="help-info-title"><h3 id="help-info-title">Полезная информация</h3><p>Информация о местах, включая часы работы, цены и доступность, может меняться. Перед посещением рекомендуем проверить актуальные данные по ссылкам в карточке места.</p></section>`;
}
export function createHelpUI({$,getData,esc}){
 const dialog=$('help-dialog');
 $('help-close').onclick=()=>dialog.close();
 dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;
  const bounds=dialog.getBoundingClientRect();
  if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();
 });
 return {open(){const data=getData();if(!data)return;$('help-content').innerHTML=helpContent(data,esc);dialog.showModal();dialog.scrollTop=0;$('help-title').focus({preventScroll:true})}};
}
