import { useSyncExternalStore } from 'react';
import { shortId } from '../lib/format';

const noop = () => () => {};

/** The id in /section/<id>, read from the address bar (null on the server and on the "_" shell). */
export function usePathId(section: 'matches' | 'players' | 'news'): string | null {
  return useSyncExternalStore(
    noop,
    () => shortId(window.location.pathname, section),
    () => null,
  );
}
