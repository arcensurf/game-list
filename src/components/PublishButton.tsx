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
    if (!confirm('Build and publish to GitHub Pages?')) return;

    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }

    setState('publishing');

    try {
      const res = await fetch('/api/publish', { method: 'POST' });
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
