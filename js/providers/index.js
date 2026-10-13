import { dropbox } from './dropbox.js';
import { gdrive } from './gdrive.js';

export const providers = { [gdrive.id]: gdrive, [dropbox.id]: dropbox };

export const getProvider = (id) => providers[id];
