import { ArchiveView } from '../components/ArchiveView';
import { DataGate } from '../components/DataGate';

export default function Matches() {
  return <DataGate>{(idx) => <ArchiveView idx={idx} />}</DataGate>;
}
