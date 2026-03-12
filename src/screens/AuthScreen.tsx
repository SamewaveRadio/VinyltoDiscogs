import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Mode = 'login' | 'signup';

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

    if (error) setError(error.message);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="border border-black">
          <div className="border-b border-black px-6 py-4 bg-black">
            <h1 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white">
              Vinyl to Discogs
            </h1>
          </div>

          <div className="flex border-b border-black">
            {(['login', 'signup'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(''); }}
                className={`flex-1 py-2.5 text-[9px] font-semibold uppercase tracking-widest transition-colors ${
                  mode === m
                    ? 'bg-neutral-50 text-black'
                    : 'text-neutral-400 hover:text-black hover:bg-neutral-50'
                } ${m === 'login' ? 'border-r border-black' : ''}`}
              >
                {m === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-6 space-y-0">
            {error && (
              <div className="border border-black px-3 py-2 mb-4">
                <p className="text-[10px] text-black">{error}</p>
              </div>
            )}

            <div className="border border-black mb-4">
              <div className="border-b border-neutral-200 flex items-center">
                <div className="w-20 px-3 py-2.5 border-r border-neutral-200 bg-neutral-50 shrink-0">
                  <p className="text-[8px] uppercase tracking-widest font-medium text-neutral-500">Email</p>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  className="flex-1 px-3 py-2.5 text-xs text-black bg-white focus:outline-none placeholder:text-neutral-300"
                />
              </div>
              <div className="flex items-center">
                <div className="w-20 px-3 py-2.5 border-r border-neutral-200 bg-neutral-50 shrink-0">
                  <p className="text-[8px] uppercase tracking-widest font-medium text-neutral-500">Password</p>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="flex-1 px-3 py-2.5 text-xs text-black bg-white focus:outline-none placeholder:text-neutral-300"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-black text-white text-[9px] font-semibold uppercase tracking-widest hover:bg-neutral-800 disabled:opacity-50 transition-colors"
            >
              {loading && <Loader2 className="w-3 h-3 animate-spin" />}
              {mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
