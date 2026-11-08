// Shared eight-spoke mark for the application and generated site icons.
export const brandStrokes = [[32, 12, 32, 52], [12, 32, 52, 32], [18, 18, 46, 46], [18, 46, 46, 18]];
export const brandPath = brandStrokes.map(([x, y, a, b]) => `M${x} ${y}L${a} ${b}`).join('');
