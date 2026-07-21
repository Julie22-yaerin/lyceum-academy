/**
 * LibraryPage — thelyceum.site/library. A public blog/research-paper
 * sharing page: anyone can read; commenting, reacting, and publishing
 * require a signed-in (accepted) account. Rendered as a standalone route
 * (see App.tsx path-based routing) — not part of the internal workspace.
 */
import { useEffect, useState } from 'react';
import {
  listLibraryPosts, getLibraryPost, createLibraryPost, addLibraryComment, reactToLibraryPost,
  type LibraryPost, type LibraryPostDetail,
} from '../lib/lyceumApi';
import { useAuth } from '../context/AuthContext';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';

const REACTION_EMOJI = ['👍', '❤️', '🤯', '💡', '🔥', '🤔'];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000), h = Math.floor(ms / 3600000), d = Math.floor(ms / 86400000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

function ComposeModal({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<'blog' | 'paper'>('blog');
  const [paperUrl, setPaperUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!title.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await createLibraryPost(title.trim(), body.trim(), type, paperUrl.trim());
      onPosted();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not publish.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-card rounded-3xl p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <p className="text-lg font-serif text-white">Share with the Library</p>
          <button onClick={onClose} className="text-white/40 hover:text-white/80">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="flex gap-2 mb-3">
          {(['blog', 'paper'] as const).map(t => (
            <button key={t} onClick={() => setType(t)}
              className={`px-3 py-1.5 rounded-xl text-[11px] uppercase tracking-[1.5px] ${type === t ? 'glass-pill-active' : 'glass-pill'}`}>
              {t === 'blog' ? 'Blog post' : 'Research paper'}
            </button>
          ))}
        </div>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title"
          className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-white/90 outline-none border border-white/10 focus:border-white/25 mb-3" />
        {type === 'paper' && (
          <input value={paperUrl} onChange={e => setPaperUrl(e.target.value)} placeholder="Link to the paper (PDF/DOI/arXiv)…"
            className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-white/90 outline-none border border-white/10 focus:border-white/25 mb-3" />
        )}
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
          placeholder={type === 'paper' ? 'Abstract / why it matters…' : 'Write your post…'}
          className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-white/90 outline-none border border-white/10 focus:border-white/25 resize-y mb-3" />
        {error && <p className="text-xs text-red-300/80 mb-3">{error}</p>}
        <div className="flex justify-end">
          <LiquidMetalButton label={busy ? 'Publishing…' : 'Publish'} onClick={submit} />
        </div>
      </div>
    </div>
  );
}

function PostDetail({ postId, onBack }: { postId: string; onBack: () => void }) {
  const { user } = useAuth();
  const [post, setPost] = useState<LibraryPostDetail | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() { setPost(await getLibraryPost(postId).catch(() => null)); }
  useEffect(() => { refresh(); }, [postId]);

  async function submitComment() {
    if (!comment.trim() || busy || !user) return;
    setBusy(true);
    try { await addLibraryComment(postId, comment.trim()); setComment(''); await refresh(); }
    finally { setBusy(false); }
  }

  async function react(emoji: string) {
    if (!user) return;
    await reactToLibraryPost(postId, emoji);
    await refresh();
  }

  if (!post) return <div className="max-w-2xl mx-auto py-16 text-center text-slate-500 text-sm">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <button onClick={onBack} className="text-xs text-slate-500 hover:text-slate-300 mb-6 flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[15px]">arrow_back</span> Back to Library
      </button>

      <span className="text-[10px] uppercase tracking-[2px] text-purple-300">{post.type === 'paper' ? 'Research Paper' : 'Blog'}</span>
      <h1 className="font-serif text-3xl text-white mt-1 mb-2">{post.title}</h1>
      <p className="text-xs text-slate-500 mb-6">{post.author_name} · {timeAgo(post.created_at)}</p>

      {post.paper_url && (
        <a href={post.paper_url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-amber-300 border border-amber-400/30 rounded-full px-3 py-1.5 mb-6 hover:bg-amber-400/10">
          <span className="material-symbols-outlined text-[14px]">description</span> View paper
        </a>
      )}

      <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap mb-8">{post.body}</p>

      <div className="flex flex-wrap gap-2 mb-8">
        {REACTION_EMOJI.map(e => (
          <button key={e} onClick={() => react(e)}
            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${post.reactions[e] ? 'border-purple-400/50 bg-purple-400/10' : 'border-white/10 hover:border-white/25'}`}>
            {e} {post.reactions[e] || ''}
          </button>
        ))}
      </div>

      <div className="border-t border-white/10 pt-6">
        <p className="text-xs uppercase tracking-[2px] text-slate-500 mb-4">{post.comments.length} comments</p>
        <div className="flex flex-col gap-4 mb-6">
          {post.comments.map(c => (
            <div key={c.id} className="glass-pill rounded-2xl px-4 py-3">
              <p className="text-xs text-slate-400 mb-1">{c.author_name} · {timeAgo(c.created_at)}</p>
              <p className="text-sm text-slate-200">{c.content}</p>
            </div>
          ))}
        </div>
        {user ? (
          <div className="flex gap-2">
            <input value={comment} onChange={e => setComment(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitComment(); }}
              placeholder="Add a comment…"
              className="flex-1 bg-white/5 rounded-xl px-3 py-2.5 text-sm text-white/90 outline-none border border-white/10 focus:border-white/25" />
            <button onClick={submitComment} disabled={busy || !comment.trim()}
              className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] disabled:opacity-30">
              Post
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            <a href="/" className="underline hover:text-slate-300">Sign in</a> to comment and react.
          </p>
        )}
      </div>
    </div>
  );
}

export default function LibraryPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<LibraryPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);

  async function refresh() {
    setLoading(true);
    try { setPosts((await listLibraryPosts()).posts); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  return (
    <div className="relative bg-[#050508] text-slate-200 font-sans antialiased min-h-screen">
      <header className="max-w-4xl mx-auto px-4 pt-10 pb-6 flex items-center justify-between">
        <a href="/" className="font-serif text-lg tracking-[3px] uppercase text-slate-300">The Lyceum</a>
        <div className="flex items-center gap-4">
          <span className="text-xs uppercase tracking-[2px] text-purple-300">Library</span>
          {user && (
            <button onClick={() => setShowCompose(true)}
              className="glass-btn rounded-full px-4 py-2 text-[10px] uppercase tracking-[2px]">
              + Share
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pb-20">
        {activeId ? (
          <PostDetail postId={activeId} onBack={() => setActiveId(null)} />
        ) : (
          <>
            <div className="text-center mb-10">
              <h1 className="font-garamond text-3xl md:text-4xl text-metallic mb-2">Library</h1>
              <p className="text-slate-400 text-sm max-w-md mx-auto">
                Blog posts and research papers shared by the Lyceum community — read, discuss, react.
              </p>
            </div>

            {loading ? (
              <p className="text-center text-slate-500 text-sm">Loading…</p>
            ) : posts.length === 0 ? (
              <p className="text-center text-slate-500 text-sm">Nothing shared yet — be the first.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {posts.map(p => (
                  <button key={p.id} onClick={() => setActiveId(p.id)}
                    className="glass rounded-2xl p-5 text-left hover:bg-white/[0.06] transition-colors">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[9px] uppercase tracking-[2px] text-purple-300">{p.type === 'paper' ? 'Paper' : 'Blog'}</span>
                      <span className="text-[11px] text-slate-500">{p.author_name} · {timeAgo(p.created_at)}</span>
                    </div>
                    <p className="font-serif text-lg text-white mb-1">{p.title}</p>
                    <p className="text-xs text-slate-500 line-clamp-2">{p.body.slice(0, 160)}</p>
                    <div className="flex items-center gap-3 mt-3 text-xs text-slate-500">
                      <span>💬 {p.comment_count}</span>
                      {Object.entries(p.reactions).map(([e, n]) => <span key={e}>{e} {n}</span>)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {showCompose && <ComposeModal onClose={() => setShowCompose(false)} onPosted={refresh} />}
    </div>
  );
}
