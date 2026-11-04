import { DataGate } from '../components/DataGate';
import { NewsIndex } from '../components/NewsViews';

export default function News() {
  return <DataGate>{(idx) => <NewsIndex idx={idx} />}</DataGate>;
}
