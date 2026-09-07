import { getHost } from '../platform/lifecycle.js';

// Summary feedback belongs to the assistant footer, including background saves.
export const feedback = Object.fromEntries(['info', 'success', 'warning', 'error'].map(kind => [kind, message => getHost()?.status?.(String(message), kind)]));
