import { dropbox } from './dropbox.js';
import { gdrive } from './gdrive.js';
import { local } from './local.js';

/** Sources shown on the home screen. */
export const providers = { [local.id]: local, [gdrive.id]: gdrive, [dropbox.id]: dropbox };

/** Sources that play music but don't appear on the home screen (e.g. shared records). */
const hidden = {};
export const registerHidden = (p) => { hidden[p.id] = p; };

export const getProvider = (id) => providers[id] || hidden[id];
