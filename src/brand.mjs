// Shared eight-spoke mark: paths avoid emoji/font substitutions on iPhone.
export const brandStrokes=[[32,12,32,52],[12,32,52,32],[18,18,46,46],[18,46,46,18]];
export const brandPath=brandStrokes.map(([x,y,a,b])=>`M${x} ${y}L${a} ${b}`).join('');
export const brandMark=`<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path d="${brandPath}"/></svg>`;
export const iconBackground=[244,245,247],iconForeground=[48,93,117];
export const favicon=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#f4f5f7"/><path d="${brandPath}" fill="none" stroke="#305d75" stroke-width="3.5" stroke-linecap="round"/></svg>\n`;
