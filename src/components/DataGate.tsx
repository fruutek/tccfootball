import type { ReactNode } from 'react';
import { useSiteState, type SiteData } from '../lib/data';
import { getIndex, type Index } from '../lib/view';
import { Empty, IconBall, PageSkeleton } from './ui';

/**
 * Shows a skeleton while loading, a friendly message on failure, and otherwise
 * hands the page a ready-to-use index of the data. Stale cached data is shown
 * while a refresh is in flight, so repeat visits paint instantly.
 */
export function DataGate({ children }: { children: (idx: Index, data: SiteData) => ReactNode }) {
  const state = useSiteState();
  if (!state.data) {
    if (state.status === 'error') {
      return (
        <div className="page">
          <Empty title="Can't load the latest results" icon={<IconBall />}>
            {state.message}
          </Empty>
        </div>
      );
    }
    return <PageSkeleton />;
  }
  return (
    <>
      {state.status === 'ready' && state.offline && (
        <div className="container note" style={{ paddingTop: 8 }}>
          Offline — showing the last results this device saw.
        </div>
      )}
      {children(getIndex(state.data), state.data)}
    </>
  );
}
