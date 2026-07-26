/**
 * SuggestedConnections — two clearly separated layouts per the founder's
 * ask: potential customers (founder ↔ visitor) and founders worth
 * connecting with (founder ↔ founder). Recomputed once daily server-side
 * (app.services.forum.recompute_connections, an APScheduler job) — this
 * component just reads and lets the member start a DM or dismiss a card.
 */
import { useEffect, useState } from 'react';
import { getForumConnections, dismissForumConnection, type ForumConnection } from '../lib/forum';

function ConnectionCard({ conn, onConnect, onDismiss }: {
  conn: ForumConnection; onConnect: (email: string) => void; onDismiss: (id: string) => void;
}) {
  return (
    <div className="glass rounded-2xl p-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-serif text-white">{conn.match.name}</p>
        <p className="text-xs text-slate-500 mb-1">
          {conn.match.role === 'founder' ? (conn.match.business_name || conn.match.industry || 'Founder') : 'Đang tìm sản phẩm'}
        </p>
        <p className="text-xs text-slate-400 italic">{conn.reason}</p>
      </div>
      <div className="flex flex-col gap-1.5 shrink-0">
        <button onClick={() => onConnect(conn.match_email)} className="glass-btn rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-wider">
          Kết nối
        </button>
        <button onClick={() => onDismiss(conn.id)} className="text-[10px] text-slate-500 hover:text-slate-300">Bỏ qua</button>
      </div>
    </div>
  );
}

export default function SuggestedConnections({ onConnect }: { onConnect: (email: string) => void }) {
  const [customers, setCustomers] = useState<ForumConnection[]>([]);
  const [founders, setFounders] = useState<ForumConnection[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await getForumConnections();
      setCustomers(res.customers); setFounders(res.founders);
    } catch { /* not logged in yet, or no suggestions computed today */ }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function dismiss(id: string) {
    await dismissForumConnection(id).catch(() => {});
    refresh();
  }

  if (loading) return <p className="text-center text-slate-500 text-sm py-6">Loading…</p>;
  if (customers.length === 0 && founders.length === 0) return null;

  return (
    <div className="flex flex-col gap-8 mb-12">
      {customers.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-[2px] text-emerald-300 mb-3">Khách hàng tiềm năng</p>
          <div className="flex flex-col gap-2">
            {customers.map(c => <ConnectionCard key={c.id} conn={c} onConnect={onConnect} onDismiss={dismiss} />)}
          </div>
        </div>
      )}
      {founders.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-[2px] text-purple-300 mb-3">Founder nên kết nối</p>
          <div className="flex flex-col gap-2">
            {founders.map(c => <ConnectionCard key={c.id} conn={c} onConnect={onConnect} onDismiss={dismiss} />)}
          </div>
        </div>
      )}
    </div>
  );
}
