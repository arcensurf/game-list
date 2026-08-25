import { useEffect, useRef, useState } from 'react';

export default function PublishButton() {
  const [state, setState] = useState<'idle' | 'publishing' | 'done' | 'error'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const handlePublish = async () => {
    if (!confirm('Publish changes to the live site?')) return;

    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }

    setState('publishing');

    try {
      // No body to send, but the dev API requires a JSON content-type on
      // every POST — it's what stops an unrelated page in the same
      // browser from driving these endpoints with a simple form post.
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (res.ok) {
        setState('done');
        resetTimer.current = setTimeout(() => { setState('idle'); }, 3000);
      } else {
        console.error('Publish failed:', data.error || data);
        setState('error');
      }
    } catch (err) {
      console.error('Publish failed:', err);
      setState('error');
    }
  };

  return (
    <div className="publish-wrapper">
      <button
        className={`publish-btn ${state}`}
        onClick={handlePublish}
        disabled={state === 'publishing'}
      >
        {state === 'publishing' ? 'Publishing...' : state === 'done' ? 'Published!' : 'Publish'}
      </button>
      {state === 'error' && (
        <span className="publish-error">Failed (see console)</span>
      )}
    </div>
  );
}
