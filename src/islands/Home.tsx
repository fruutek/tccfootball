import { DataGate } from '../components/DataGate';
import { HomeView } from '../components/HomeView';

export default function Home() {
  return <DataGate>{(idx) => <HomeView idx={idx} />}</DataGate>;
}
