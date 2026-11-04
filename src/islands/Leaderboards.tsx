import { DataGate } from '../components/DataGate';
import { LeaderboardView } from '../components/LeaderboardView';

export default function Leaderboards() {
  return <DataGate>{(idx) => <LeaderboardView idx={idx} />}</DataGate>;
}
