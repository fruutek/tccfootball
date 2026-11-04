import { useSiteState } from '../lib/data';

/** Shown on every page while fictional demo documents exist. Disappears after `demo purge`. */
export default function DemoBanner() {
  const state = useSiteState();
  if (!state.data?.settings?.demoData) return null;
  return (
    <div className="demo-banner" role="note">
      <b>DEMO</b>All players, matches and articles on this site are fictional test data.
    </div>
  );
}
