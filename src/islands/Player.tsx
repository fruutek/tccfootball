import { DataGate } from '../components/DataGate';
import { PlayerProfile } from '../components/PlayerViews';
import { usePathId } from './hooks';

export default function Player() {
  const id = usePathId('players');
  return <DataGate>{(idx) => <PlayerProfile idx={idx} playerId={id} />}</DataGate>;
}
