// Inline SVG icons (24px grid, currentColor).
const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor">${body}</svg>`;

export const icons = {
  play: svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
  next: svg('<path d="M5 6.5v11a1 1 0 0 0 1.55.83L14 13.2V17a1 1 0 0 0 2 0V7a1 1 0 0 0-2 0v3.8L6.55 5.67A1 1 0 0 0 5 6.5z"/><rect x="17" y="6" width="2" height="12" rx="1"/>'),
  prev: svg('<path d="M19 6.5v11a1 1 0 0 1-1.55.83L10 13.2V17a1 1 0 0 1-2 0V7a1 1 0 0 1 2 0v3.8l7.45-5.13A1 1 0 0 1 19 6.5z"/><rect x="5" y="6" width="2" height="12" rx="1"/>'),
  shuffle: svg('<path d="M17 3l4 4-4 4V8h-2.3l-3.2 4 3.2 4H17v-3l4 4-4 4v-3h-3.3l-3.7-4.6L6.3 18H3v-2h2.3l3.2-4-3.2-4H3V6h3.3L10 10.6 13.7 6H17V3z"/>'),
  repeat: svg('<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>'),
  repeatOne: svg('<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/><path d="M13 15V9h-1l-2 1v1h1.5v4H13z"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="1"/>'),
  eject: svg('<path d="M12 5 4.5 14h15L12 5zM4.5 16.5h15V19h-15z"/>'),
  folder: svg('<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11z"/>'),
  note: svg('<path d="M10 17.5a3 3 0 1 1-2-2.83V5.5a1 1 0 0 1 .76-.97l9-2.25A1 1 0 0 1 19 3.25V15a3 3 0 1 1-2-2.83V6.03l-7 1.75v9.72z"/>'),
  download: svg('<path d="M11 4a1 1 0 1 1 2 0v8.6l2.8-2.8a1 1 0 1 1 1.4 1.4l-4.5 4.5a1 1 0 0 1-1.4 0l-4.5-4.5a1 1 0 1 1 1.4-1.4l2.8 2.8V4zM5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/>'),
  saved: svg('<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.4-5.4 1.4 1.4-6.8 6.8z"/>'),
  trash: svg('<path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9z"/>'),
  settings: svg('<path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5L19.4 13zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>'),
  back: svg('<path d="M15.7 5.3a1 1 0 0 1 0 1.4L10.4 12l5.3 5.3a1 1 0 0 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0z"/>'),
  down: svg('<path d="M5.3 8.3a1 1 0 0 1 1.4 0L12 13.6l5.3-5.3a1 1 0 1 1 1.4 1.4l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4z"/>'),
  cloud: svg('<path d="M7 19a5 5 0 0 1-.9-9.92A6.5 6.5 0 0 1 18.6 9.5 4.75 4.75 0 0 1 17.5 19H7z"/>'),
  phone: svg('<path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v13h10V5H7zm5 14.2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>'),
  layers: svg('<path d="M12 3 2 8l10 5 10-5-10-5zm-7.8 8.9L2 13l10 5 10-5-2.2-1.1L12 15.8l-7.8-3.9zm0 4L2 17l10 5 10-5-2.2-1.1L12 19.8l-7.8-3.9z"/>'),
};
