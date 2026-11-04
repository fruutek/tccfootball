import { DataGate } from '../components/DataGate';
import { MatchCentre } from '../components/MatchViews';
import { usePathId } from './hooks';

export default function Match() {
  const id = usePathId('matches');
  return <DataGate>{(idx) => <MatchCentre idx={idx} matchId={id} />}</DataGate>;
}
