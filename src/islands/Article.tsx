import { DataGate } from '../components/DataGate';
import { ArticleView } from '../components/NewsViews';
import { usePathId } from './hooks';

export default function Article() {
  const slug = usePathId('news');
  return <DataGate>{(idx) => <ArticleView idx={idx} slug={slug} />}</DataGate>;
}
