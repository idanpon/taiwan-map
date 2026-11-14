const holdDuration = 425;
const guardRadius = 28;
const holdSlop = 8;

export function markerSwipeAction(dx, dy) {
 const distance = Math.hypot(dx, dy);
 if (distance <= guardRadius || Math.abs(dy) <= distance / 2) return null;
 return dy < 0 ? 'maps' : 'visited';
}

export function installMapMarkerActions(surface, {actionsFor, onAction, canHoldGroup, onHoldGroup}) {
 let press;
 let holdTimer;
 let suppressedClick;

 function reset() {
  clearTimeout(holdTimer);
  if (press?.overlay) {
   press.overlay.remove();
   delete press.marker.dataset.quickAction;
  }
  press = null;
 }

 function showActions() {
  if (!press?.marker.isConnected) return reset();
  const group = press.marker.dataset.mapGroup;
  if (group) {
   if (!canHoldGroup()) return reset();
   press.groupOpened = true;
   onHoldGroup(group);
   return;
  }
  const actions = actionsFor(press.marker.dataset.mapPlace);
  if (!actions.length) return reset();
  const rect = press.marker.getBoundingClientRect();
  press.centerX = rect.left + rect.width / 2;
  press.centerY = rect.top + rect.height / 2;
  press.actions = actions;
  const mapRect = surface.getBoundingClientRect();
  const labelX = Math.max(mapRect.left + 68, Math.min(mapRect.right - 68, press.centerX));
  const overlay = document.createElement('span');
  overlay.className = 'map-quick-actions';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.setProperty('--map-quick-label-x', (labelX - press.centerX) + 'px');
  for (const action of actions) {
   const direction = document.createElement('span');
   direction.className = 'map-quick-direction';
   direction.dataset.action = action;
   const hint = document.createElement('span');
   hint.className = 'map-quick-hint';
   const preferredY = press.centerY + (action === 'maps' ? -70 : 70);
   const labelY = Math.max(mapRect.top + 16, Math.min(mapRect.bottom - 16, preferredY));
   hint.style.setProperty('--map-quick-label-y', (labelY - press.centerY) + 'px');
   hint.textContent = action === 'maps' ? '↑ Google Maps' : '↓ Уже посетили';
   direction.append(hint);
   overlay.append(direction);
  }
  press.overlay = overlay;
  press.marker.dataset.quickAction = '';
  press.marker.prepend(overlay);
 }

 function getAction(touch) {
  const action = markerSwipeAction(touch.clientX - press.centerX, touch.clientY - press.centerY);
  return press.actions.includes(action) ? action : null;
 }

 surface.addEventListener('touchstart', event => {
  reset();
  suppressedClick = null;
  if (event.touches.length !== 1) return;
  const marker = event.target.closest('[data-map-place], [data-map-group]');
  if (!marker) return;
  if (marker.dataset.mapGroup ? !canHoldGroup() : !actionsFor(marker.dataset.mapPlace).length) return;
  const {identifier, clientX, clientY} = event.touches[0];
  press = {marker, identifier, clientX, clientY};
  holdTimer = setTimeout(showActions, holdDuration);
 }, {passive: true});

 surface.addEventListener('touchmove', event => {
  if (!press) return;
  const touch = event.touches[0];
  if (event.touches.length !== 1 || touch.identifier !== press.identifier || !press.marker.isConnected) {
   reset();
   return;
  }
  if (!press.groupOpened && !press.overlay) {
   if (Math.hypot(touch.clientX - press.clientX, touch.clientY - press.clientY) > holdSlop) reset();
   return;
  }
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
  if (press.overlay) press.marker.dataset.quickAction = getAction(touch) || '';
 }, {capture: true, passive: false});

 surface.addEventListener('touchend', event => {
  if (!press) return;
  const touch = Array.from(event.changedTouches).find(value => value.identifier === press.identifier);
  if ((!press.overlay && !press.groupOpened) || !touch || event.touches.length || !press.marker.isConnected) return reset();
  const {marker} = press;
  const id = marker.dataset.mapPlace;
  const action = press.overlay ? getAction(touch) : null;
  suppressedClick = {marker, until: event.timeStamp + 500};
  if (event.cancelable) event.preventDefault();
  reset();
  if (action && actionsFor(id).includes(action)) onAction(id, action);
 }, {capture: true, passive: false});

 surface.addEventListener('click', event => {
  if (!event.detail || !suppressedClick?.marker.contains(event.target) ||
      event.timeStamp >= suppressedClick.until) return;
  event.preventDefault();
  event.stopImmediatePropagation();
 }, {capture: true});
 surface.addEventListener('contextmenu', event => {
  if (press?.marker.contains(event.target)) event.preventDefault();
 });
 surface.addEventListener('touchcancel', reset, {passive: true});
 window.addEventListener('blur', reset);
 document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
}
