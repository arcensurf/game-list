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
  const [loading, setLoading] = useState(true);
  const [gameName, setGameName] = useState(title);
  const [selecting, setSelecting] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/browse-covers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, sgdbId }),
    })
      .then((r) => r.json())
      .then((data) => {
        setImages(data.images || []);
        setGameName(data.gameName || title);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [title, sgdbId]);

  const handleSelect = async (img: SgdbImage) => {
    setSelecting(img.id);
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
      onClose(data.coverUrl);
    } else {
      setSelecting(null);
    }
  };

  const handleLocalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
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
        onClose(data.coverUrl);
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
