// Shown when games.json can't be read. Worth a real component rather
// than another inline branch in App: the list can't render at all
// without this file, so it's the one failure the reader has to be able
// to act on — and the retry needs somewhere to live.

type Props = {
  onRetry: () => void;
};

export default function DataLoadFailure({ onRetry }: Props) {
  return (
    <div className="data-load-failure">
      <p className="data-load-failure__line">No signal.</p>
      <p className="data-load-failure__detail">Couldn't reach the collection.</p>
      <button type="button" className="data-load-failure__retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
