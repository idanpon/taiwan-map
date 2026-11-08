function bindDivider(divider, { measure, apply, reset, coordinate, decrease, increase }) {
  const minimum = Number(divider.getAttribute('aria-valuemin'));
  const maximum = Number(divider.getAttribute('aria-valuemax'));
  let drag;

  function layout() {
    const { size, unit, limit = maximum } = measure();
    const max = Math.min(maximum, Math.max(0, Math.floor(limit)));
    return { unit, value: size / unit, min: Math.min(minimum, max), max };
  }

  function clamp(value, { min, max }) {
    return Math.max(min, Math.min(max, value));
  }

  divider.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || drag) return;
    event.preventDefault();
    divider.focus({ preventScroll: true });
    divider.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, start: event[coordinate], ...layout() };
    divider.dataset.dragging = '';
  });

  divider.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const value = drag.value + (event[coordinate] - drag.start) / drag.unit;
    apply(clamp(value, drag));
  });

  divider.addEventListener('lostpointercapture', event => {
    if (drag?.id !== event.pointerId) return;
    drag = undefined;
    delete divider.dataset.dragging;
  });

  divider.addEventListener('dblclick', reset);

  divider.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      reset();
      return;
    }
    const bounds = layout();
    const { value, min, max } = bounds;
    const step = 16 / bounds.unit;
    const targets = { [decrease]: value - step, [increase]: value + step, Home: min, End: max };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    apply(clamp(targets[event.key], bounds));
  });

  return () => {
    if (!divider.offsetWidth) return;
    const bounds = layout();
    divider.setAttribute('aria-valuemin', bounds.min);
    divider.setAttribute('aria-valuemax', bounds.max);
    divider.setAttribute('aria-valuenow', Math.round(clamp(bounds.value, bounds)));
  };
}

export function installSidebarResize({ panel, filters, list, heading, footer, widthDivider, heightDivider }) {
  const updateWidth = bindDivider(widthDivider, {
    measure: () => ({
      size: panel.offsetWidth,
      unit: parseFloat(getComputedStyle(panel).getPropertyValue('--sidebar-base-width')) / 100,
    }),
    apply: value => panel.style.setProperty('--sidebar-width-factor', value / 100),
    reset: () => panel.style.removeProperty('--sidebar-width-factor'),
    coordinate: 'clientX',
    decrease: 'ArrowLeft',
    increase: 'ArrowRight',
  });

  const updateHeight = bindDivider(heightDivider, {
    measure: () => {
      const unit = panel.clientHeight / 100;
      const listReserve = parseFloat(getComputedStyle(list).minHeight);
      const roomForFilters = panel.clientHeight - heading.offsetHeight - footer.offsetHeight - listReserve;
      return { size: filters.offsetHeight, unit, limit: roomForFilters / unit };
    },
    apply: value => panel.style.setProperty('--sidebar-filter-size', `${value}%`),
    reset: () => panel.style.removeProperty('--sidebar-filter-size'),
    coordinate: 'clientY',
    decrease: 'ArrowUp',
    increase: 'ArrowDown',
  });

  const observer = new ResizeObserver(() => {
    updateWidth();
    updateHeight();
  });
  for (const element of [panel, filters, heading, footer]) observer.observe(element);
}
