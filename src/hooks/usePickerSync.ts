import { useEffect, useRef, useState } from 'react';
import type { Roll } from './useTrophyPicker';

const ENDPOINT = '/api/picker-state';
const POLL_MS = 1000;

/**
 * Publish each roll from the control window.
 *
 * OBS's browser source is a separate browser process, so it shares no
 * localStorage or BroadcastChannel with the window you're driving from.
 * The dev server is the only thing both can reach, so the roll goes
 * through it.
 */
export function usePickerBroadcast(roll: Roll | null, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !roll) return;
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roll }),
    }).catch(() => {
      // The stage just keeps showing the previous roll — not worth
      // interrupting the person mid-stream over.
    });
  }, [roll, enabled]);
}

/**
 * Follow whatever the control window last published.
 *
 * Polling rather than SSE: one request a second against a local dev
 * server is nothing, and it reconnects on its own if either side
 * restarts mid-stream — which an EventSource would need handling for.
 */
export function usePickerFollower(enabled: boolean): Roll | null {
  const [roll, setRoll] = useState<Roll | null>(null);
  // Compared as JSON so an unchanged roll doesn't re-render the stage
  // every second.
  const lastSeen = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { roll: Roll | null };
        if (cancelled) return;
        const encoded = JSON.stringify(data.roll);
        if (encoded === lastSeen.current) return;
        lastSeen.current = encoded;
        setRoll(data.roll);
      } catch {
        // Dev server restarting, most likely. Next tick tries again.
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  return roll;
}
