import { dropbox } from './dropbox.js';
import { gdrive } from './gdrive.js';
import { local } from './local.js';

export const providers = { [local.id]: local, [gdrive.id]: gdrive, [dropbox.id]: dropbox };

export const getProvider = (id) => providers[id];
