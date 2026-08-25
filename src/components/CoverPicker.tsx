import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface SgdbImage {
  id: number;
  url: string;
  thumb: string;
  score: number;
}

export default function CoverPicker({
  title,
  sgdbId,
  onClose,
}: {
  title: string;
  sgdbId?: number | null;
  onClose: (newCoverUrl?: string) => void;
}) {
  const [images, setImages] = useState<SgdbImage[]>([]);
  // A save can fail for reasons worth reading — most usefully sharp being
  // unavailable, which is the difference between a WebP cover and a PNG
  // eight times the size. Swallowing it was how a batch of unconverted
  // covers reached the bucket unnoticed.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [gameName, setGameName] = useState(title);
  const [selecting, setSelecting] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/browse-covers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, sgdbId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setImages(data.images || []);
        setGameName(data.gameName || title);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [title, sgdbId]);

  // The endpoints answer with { error } on failure; fall back to the
  // status when the body isn't JSON (a crash before the handler responds).
  const errorFrom = async (res: Response): Promise<string> => {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return data?.error ?? `Request failed (${res.status})`;
  };

  const handleSelect = async (img: SgdbImage) => {
    setSelecting(img.id);
    setSaveError(null);
    const res = await fetch('/api/select-cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        imageUrl: img.url,
        sgdbId: img.id,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      window.dispatchEvent(new Event('games-updated'));
      onClose(data.coverUrl);
    } else {
      setSaveError(await errorFrom(res));
      setSelecting(null);
    }
  };

  const handleLocalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      setSaveError(null);
      const base64 = (reader.result as string).split(',')[1];
      const res = await fetch('/api/upload-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          imageData: base64,
          filename: file.name,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new Event('games-updated'));
        onClose(data.coverUrl);
      } else {
        setSaveError(await errorFrom(res));
      }
    };
    reader.readAsDataURL(file);
  };

  return createPortal(
    <div className="cover-picker-backdrop" onClick={() => onClose()}>
      <div className="cover-picker" onClick={(e) => e.stopPropagation()}>
        <div className="cover-picker-header">
          <h2>Choose Cover: {gameName}</h2>
          <button className="cover-picker-close" onClick={() => onClose()}>
            X
          </button>
        </div>

        <div className="cover-picker-actions">
          <button onClick={() => fileInputRef.current?.click()}>
            Upload from file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleLocalUpload}
            style={{ display: 'none' }}
          />
        </div>

        {saveError && <p className="cover-picker-error">{saveError}</p>}

        {loading ? (
          <p className="cover-picker-status">Searching SteamGridDB...</p>
        ) : images.length === 0 ? (
          <p className="cover-picker-status">
            No images found on SteamGridDB. Use the upload button above.
          </p>
        ) : (
          <div className="cover-picker-grid">
            {images.map((img) => (
              <button
                key={img.id}
                className={`cover-picker-option ${selecting === img.id ? 'selecting' : ''}`}
                onClick={() => handleSelect(img)}
                disabled={selecting !== null}
              >
                <img src={img.thumb} alt={`Option ${img.id}`} loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
