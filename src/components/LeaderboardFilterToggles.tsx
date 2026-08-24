import LampToggle from './LampToggle';
import type { LeaderboardFilters } from '../hooks/useLeaderboardFilters';

// The leaderboard's two view modifiers, living in the masthead alongside
// where the Games of Games filter sits on the list view. They were in a
// band above the table with the platform filters, which made ten controls
// stack up before any content — and they are settings you pick once
// rather than filters you sweep through, so they belong with the chrome.
export default function LeaderboardFilterToggles({
  hideDupes,
  completionsOnly,
  toggleHideDupes,
  toggleCompletionsOnly,
}: LeaderboardFilters) {
  return (
    <>
      <LampToggle
        className="masthead-lamp-toggle"
        on={hideDupes}
        label="No dupes"
        title={hideDupes ? 'Show every platform copy' : 'Collapse each game to its highest-scoring platform copy'}
        onClick={toggleHideDupes}
      />
      <LampToggle
        className="masthead-lamp-toggle"
        on={completionsOnly}
        label="100% only"
        title={completionsOnly ? 'Show every ranked game' : 'Show only games finished at 100%'}
        onClick={toggleCompletionsOnly}
      />
    </>
  );
}
