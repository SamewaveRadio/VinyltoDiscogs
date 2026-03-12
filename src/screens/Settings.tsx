import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile } from '../types';

export default function Settings() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [discogsUsername, setDiscogsUsername] = useState('');
  const [discogsToken, setDiscogsToken] = useState('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (data) {
        setProfile(data);
        setDiscogsUsername(data.discogs_username ?? '');
      }
      setLoading(false);
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setSaved(false);

    const session = (await supabase.auth.getSession()).data.session;
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/save-discogs-token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          discogs_username: discogsUsername || null,
          discogs_token: discogsToken || null,
        }),
      }
    );

    if (response.ok) {
      setProfile((prev) => prev ? { ...prev, discogs_username: discogsUsername || null, discogs_token_encrypted: discogsToken ? '***' : prev.discogs_token_encrypted } : null);
      setDiscogsToken('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }

    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="border-b border-black px-8 py-4">
        <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black">Settings</h1>
      </div>

      <div className="px-8 py-8 max-w-md">
        <div className="mb-8">
          <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400 mb-1">Account</p>
          <p className="text-xs text-neutral-600">{user?.email}</p>
        </div>

        <div>
          <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400 mb-4">Discogs Integration</p>

          <div className="border border-black mb-4">
            <div className="border-b border-neutral-200 flex items-center">
              <div className="w-28 px-3 py-2.5 border-r border-neutral-200 bg-neutral-50 shrink-0">
                <p className="text-[8px] uppercase tracking-widest font-medium text-neutral-500">Username</p>
              </div>
              <input
                type="text"
                value={discogsUsername}
                onChange={(e) => setDiscogsUsername(e.target.value)}
                placeholder="discogs_username"
                className="flex-1 px-3 py-2.5 text-xs text-black bg-white focus:outline-none placeholder:text-neutral-300"
              />
            </div>
            <div className="flex items-center">
              <div className="w-28 px-3 py-2.5 border-r border-neutral-200 bg-neutral-50 shrink-0">
                <p className="text-[8px] uppercase tracking-widest font-medium text-neutral-500">API Token</p>
              </div>
              <input
                type="password"
                value={discogsToken}
                onChange={(e) => setDiscogsToken(e.target.value)}
                placeholder={profile?.discogs_token_encrypted ? '••••••••' : 'Enter token'}
                className="flex-1 px-3 py-2.5 text-xs text-black bg-white focus:outline-none placeholder:text-neutral-300"
              />
            </div>
          </div>

          <p className="text-[9px] text-neutral-400 mb-4 leading-relaxed">
            Your Discogs personal access token is required to add records to your collection.
            Find it at discogs.com/settings/developers.
          </p>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-black text-white text-[9px] font-semibold uppercase tracking-widest hover:bg-neutral-800 disabled:opacity-50 transition-colors"
          >
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            {saved && <CheckCircle2 className="w-3 h-3" />}
            {saved ? 'Saved' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
