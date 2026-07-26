/**
 * GalleryPanel — everything saved via "Lưu vào Gallery" across the
 * workspace (Illustration's scan-a-region image/video, and anywhere else
 * that wires in saveToGallery). See backend/app/services/gallery.py.
 *
 * The file endpoint is auth-gated (private, per-user), so it can't be used
 * as a plain <img src> — same reason FloatingPodcast fetches audio as a
 * blob instead of pointing <audio> at the URL directly. Each thumbnail is
 * fetched once via authFetch and kept as an object URL for the life of
 * this panel.
 */
import { useEffect, useRef, useState } from 'react';
import { authFetch } from '../../lib/api';
import { getApiBaseUrl } from '../../lib/apiBase';
import { listGallery, deleteGalleryItem, type GalleryItem } from '../../lib/lyceumApi';

const API_BASE = getApiBaseUrl();

export default function GalleryPanel() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<GalleryItem | null>(null);
  const urlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    listGallery()
      .then(async r => {
        if (cancelled) return;
        setItems(r.items);
        for (const item of r.items) {
          try {
            const res = await authFetch(`${API_BASE}/gallery/${item.id}/file`);
            if (!res.ok) continue;
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            urlsRef.current[item.id] = url;
            if (!cancelled) setUrls(u => ({ ...u, [item.id]: url }));
          } catch { /* skip this one, keep going */ }
        }
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Không tải được gallery.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      Object.values(urlsRef.current).forEach(u => URL.revokeObjectURL(u));
    };
  }, []);

  async function handleDelete(id: string) {
    try {
      await deleteGalleryItem(id);
      setItems(list => list.filter(i => i.id !== id));
      if (viewing?.id === id) setViewing(null);
    } catch { /* leave it in the list — better than silently losing track */ }
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-[11px] text-white/50">
        Ảnh và video bạn đã lưu từ Illustration, Share Screen, v.v.
      </p>

      {loading && <p className="text-xs text-white/40 text-center py-8">Đang tải…</p>}
      {error && <p className="text-xs text-red-300/80">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="text-xs text-white/35 text-center py-8">Chưa lưu gì cả — bấm "Lưu vào Gallery" ở kết quả tạo ảnh/video.</p>
      )}

      <div className="grid grid-cols-3 gap-2">
        {items.map(item => (
          <button key={item.id} onClick={() => setViewing(item)}
            className="relative aspect-square rounded-xl overflow-hidden bg-white/5 border border-white/10 hover:border-white/25 transition-colors">
            {urls[item.id] ? (
              item.kind === 'image' ? (
                <img src={urls[item.id]} alt={item.title} className="w-full h-full object-cover" />
              ) : (
                <video src={urls[item.id]} className="w-full h-full object-cover" muted />
              )
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px] text-white/20">hourglass_empty</span>
              </div>
            )}
            {item.kind === 'video' && (
              <span className="absolute bottom-1 right-1 material-symbols-outlined text-[14px] text-white/80 bg-black/50 rounded-full p-0.5">
                play_arrow
              </span>
            )}
          </button>
        ))}
      </div>

      {viewing && (
        <div className="fixed inset-0 z-[210] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setViewing(null)}>
          <div className="max-w-2xl w-full flex flex-col gap-3" onClick={e => e.stopPropagation()}>
            {urls[viewing.id] && (
              viewing.kind === 'image' ? (
                <img src={urls[viewing.id]} alt={viewing.title} className="max-h-[75vh] w-full object-contain rounded-xl" />
              ) : (
                <video src={urls[viewing.id]} controls autoPlay className="max-h-[75vh] w-full rounded-xl" />
              )
            )}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">{viewing.title || '(không tên)'}</p>
                <p className="text-[10px] text-white/40">{viewing.subject} · {viewing.source}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleDelete(viewing.id)}
                  className="rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[1.5px] bg-red-400/10 text-red-300 hover:bg-red-400/20">
                  Xoá
                </button>
                <button onClick={() => setViewing(null)}
                  className="rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[1.5px] bg-white/10 text-white/70 hover:bg-white/20">
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
