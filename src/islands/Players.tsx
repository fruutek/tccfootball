import { DataGate } from '../components/DataGate';
import { PlayersDirectory } from '../components/PlayerViews';

export default function Players() {
  return <DataGate>{(idx) => <PlayersDirectory idx={idx} />}</DataGate>;
}
