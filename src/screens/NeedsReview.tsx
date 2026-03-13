import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { VinylRecord } from '../types';

type Screen = 'dashboard' | 'upload' | 'processing' | 'match-review' | 'needs-review' | 'settings';

interface NeedsReviewProps {
  onNavigate: (screen: Screen, recordId?: string) => void;
  recordId: string | null;
}

export default function NeedsReview({ onNavigate, recordId }: NeedsReviewProps) {
  const { user } = useAuth();
  const [records, setRecords] = useState<VinylRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState<VinylRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ artist: '', title: '', label: '', catalog_number: '', year: '' });
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('records')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'needs_review')
        .order('created_at', { ascending: false });

      const recs = data ?? [];
      setRecords(recs);

      if (recordId) {
        const target = recs.find(r => r.id === recordId);
        if (target) openRecord(target);
      }
      setLoading(false);
    })();
  }, [user, recordId]);

  const openRecord = (record: VinylRecord) => {
    setSelectedRecord(record);
    setRetryError(null);
    setMeta({
      artist: record.artist ?? '',
      title: record.title ?? '',
      label: record.label ?? '',
      catalog_number: record.catalog_number ?? '',
      year: record.year ? String(record.year) : '',
    });
  };

  const handleSave = async () => {
    if (!selectedRecord) return;
    setSaving(true);

    const yearNum = meta.year ? parseInt(meta.year, 10) : null;
    await supabase.from('records').update({
      artist: meta.artist || null,
      title: meta.title || null,
      label: meta.label || null,
      catalog_number: meta.catalog_number || null,
      year: yearNum && !isNaN(yearNum) ? yearNum : null,
      status: 'added',
    }).eq('id', selectedRecord.id);

    setRecords(prev => prev.filter(r => r.id !== selectedRecord.id));
    setSelectedRecord(null);
    setSaving(false);
  };

  const handleRetry = async () => {
    if (!selectedRecord) return;
    setRetrying(true);
    setRetryError(null);

    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

    const response = await fetch(`${supabaseUrl}/functions/v1/search-discogs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        record_id: selectedRecord.id,
        artist: meta.artist || null,
        title: meta.title || null,
        label: meta.label || null,
        catalog_number: meta.catalog_number || null,
        year: meta.year || null,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      setRetryError(result.error ?? 'Search failed.');
      setRetrying(false);
      return;
    }

    setRetrying(false);
    if (result.status === 'matched') {
      onNavigate('match-review', selectedRecord.id);
    } else {
      setRetryError('No matches found. Try adjusting the metadata.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" />
      </div>
    );
  }

  if (!selectedRecord) {
    return (
      <div>
        <div className="border-b border-black px-4 py-3 flex items-center gap-3 lg:px-8 lg:py-4 lg:gap-4">
          <button onClick={() => onNavigate('dashboard')} className="text-neutral-400 hover:text-black transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-baseline gap-2 lg:gap-4">
            <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black">Needs Review</h1>
            <span className="text-[10px] text-neutral-400 uppercase tracking-wider">{records.length} pending</span>
          </div>
        </div>

        {records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 lg:py-32">
            <CheckCircle2 className="w-6 h-6 text-neutral-300 mb-3" strokeWidth={1} />
            <p className="text-[10px] uppercase tracking-widest text-neutral-400">No records need review</p>
          </div>
        ) : (
          <div>
            <div className="hidden lg:grid grid-cols-[1fr_120px_100px_70px] px-8 py-2 border-b border-neutral-200 bg-neutral-50">
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Artist / Title</p>
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Label</p>
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Cat No.</p>
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Year</p>
            </div>
            {records.map((record) => (
              <div
                key={record.id}
                onClick={() => openRecord(record)}
                className="px-4 py-3 border-b border-neutral-100 cursor-pointer active:bg-neutral-50 lg:grid lg:grid-cols-[1fr_120px_100px_70px] lg:items-center lg:px-8 lg:hover:bg-neutral-50 transition-colors"
              >
                <div className="min-w-0 lg:pr-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium text-black truncate">{record.artist ?? '—'}</span>
                    {record.title && (
                      <><span className="text-neutral-300 text-xs shrink-0">/</span>
                        <span className="text-xs text-neutral-600 truncate">{record.title}</span></>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 lg:hidden">
                    {record.label && <span className="text-[10px] text-neutral-400 truncate">{record.label}</span>}
                    {record.catalog_number && <span className="text-[10px] text-neutral-400 font-mono truncate">{record.catalog_number}</span>}
                  </div>
                </div>
                <div className="hidden lg:block text-[11px] text-neutral-500 truncate pr-2">{record.label ?? '—'}</div>
                <div className="hidden lg:block text-[11px] text-neutral-500 font-mono truncate pr-2">{record.catalog_number ?? '—'}</div>
                <div className="hidden lg:block text-[11px] text-neutral-500">{record.year ?? '—'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-black px-4 py-3 flex items-center gap-3 lg:px-8 lg:py-4 lg:gap-4">
        <button onClick={() => setSelectedRecord(null)} className="text-neutral-400 hover:text-black transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-baseline gap-2 min-w-0 flex-1 lg:gap-4">
          <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black shrink-0">Needs Review</h1>
          <span className="text-[10px] text-neutral-400 uppercase tracking-wider truncate hidden sm:inline">
            {selectedRecord.artist ?? '—'} / {selectedRecord.title ?? 'Untitled'}
          </span>
        </div>
      </div>

      <div className="px-4 py-6 lg:px-8 lg:py-8 lg:max-w-lg">
        <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400 mb-4">
          Edit Metadata
        </p>

        <div className="border border-black mb-4">
          {[
            { key: 'artist', label: 'Artist' },
            { key: 'title', label: 'Title' },
            { key: 'label', label: 'Label' },
            { key: 'catalog_number', label: 'Cat No.' },
            { key: 'year', label: 'Year' },
          ].map(({ key, label }, i) => (
            <div key={key} className={`flex items-center ${i < 4 ? 'border-b border-neutral-200' : ''}`}>
              <div className="w-20 px-3 py-2.5 border-r border-neutral-200 bg-neutral-50 shrink-0 lg:w-24">
                <p className="text-[8px] uppercase tracking-widest font-medium text-neutral-500">{label}</p>
              </div>
              <input
                type={key === 'year' ? 'number' : 'text'}
                value={meta[key as keyof typeof meta]}
                onChange={(e) => setMeta(prev => ({ ...prev, [key]: e.target.value }))}
                className="flex-1 px-3 py-2.5 text-xs text-black bg-white focus:outline-none placeholder:text-neutral-300"
              />
            </div>
          ))}
        </div>

        {retryError && (
          <p className="text-[10px] text-neutral-500 mb-4">{retryError}</p>
        )}

        <div className="flex flex-col border border-black sm:flex-row">
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-[9px] font-semibold uppercase tracking-widest text-neutral-500 hover:bg-neutral-100 hover:text-black transition-colors border-b border-black disabled:opacity-50 sm:border-b-0 sm:border-r sm:py-2.5"
          >
            {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Retry Search
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-black text-white text-[9px] font-semibold uppercase tracking-widest hover:bg-neutral-800 disabled:opacity-50 transition-colors sm:py-2.5"
          >
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            Mark as Added
          </button>
        </div>
      </div>
    </div>
  );
}
