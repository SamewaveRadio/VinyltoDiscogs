import { useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { VinylRecord, RecordPhoto } from '../types';

interface NeedsReviewPanelProps {
  record: VinylRecord;
  photos: RecordPhoto[];
  onRecordUpdated: (record: VinylRecord) => void;
  onClose: () => void;
  onMatchFound: () => void;
}

export default function NeedsReviewPanel({
  record, photos, onRecordUpdated, onClose, onMatchFound,
}: NeedsReviewPanelProps) {
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({
    artist: record.artist ?? '',
    title: record.title ?? '',
    label: record.label ?? '',
    catalog_number: record.catalog_number ?? '',
    year: record.year ? String(record.year) : '',
  });
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const coverPhoto = photos.find(p => p.photo_type === 'cover_front') ?? photos[0];

  const handleSave = async () => {
    setSaving(true);
    const yearNum = meta.year ? parseInt(meta.year, 10) : null;
    await supabase.from('records').update({
      artist: meta.artist || null,
      title: meta.title || null,
      label: meta.label || null,
      catalog_number: meta.catalog_number || null,
      year: yearNum && !isNaN(yearNum) ? yearNum : null,
      status: 'added',
    }).eq('id', record.id);

    onRecordUpdated({ ...record, status: 'added' });
  };

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);

    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/search-discogs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        record_id: record.id,
        artist: meta.artist || null,
        title: meta.title || null,
        label: meta.label || null,
        catalog_number: meta.catalog_number || null,
        year: meta.year || null,
      }),
    });

    const result = await response.json();
    setRetrying(false);

    if (!response.ok) {
      setRetryError(result.error ?? 'Search failed.');
      return;
    }

    if (result.status === 'matched') {
      onMatchFound();
    } else {
      setRetryError('No confident matches found. Try adjusting the search terms.');
    }
  };

  return (
    <div>
      <div className="border-b border-black px-4 py-3 flex items-center gap-3 lg:px-8 lg:py-4 lg:gap-4">
        <button onClick={onClose} className="text-neutral-400 hover:text-black transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-baseline gap-2 min-w-0 flex-1 lg:gap-4">
          <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black shrink-0">Manual Review</h1>
          <span className="text-[10px] text-neutral-400 uppercase tracking-wider truncate hidden sm:inline">
            {record.artist ?? '---'} / {record.title ?? 'Untitled'}
          </span>
        </div>
      </div>

      <div className="px-4 py-6 lg:px-8 lg:py-8 lg:flex lg:gap-8 lg:max-w-3xl">
        {photos.length > 0 && (
          <div className="mb-6 lg:mb-0 lg:shrink-0 lg:w-48">
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400 mb-3">Photos</p>
            <div className="grid grid-cols-2 gap-1.5">
              {photos.slice(0, 4).map((photo) => (
                <div
                  key={photo.id}
                  className={`aspect-square border overflow-hidden bg-neutral-50 ${
                    photo.id === coverPhoto?.id ? 'border-black' : 'border-neutral-200'
                  }`}
                >
                  <img src={photo.file_url} alt={photo.photo_type} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1">
          {record.error_message && (
            <div className="border border-neutral-300 px-3 py-2 mb-4 bg-neutral-50">
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400 mb-1">Reason</p>
              <p className="text-[10px] text-neutral-600">{record.error_message}</p>
            </div>
          )}

          <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400 mb-4">
            Edit Search Terms
          </p>

          <div className="border border-black mb-4">
            {(['artist', 'title', 'label', 'catalog_number', 'year'] as const).map((key, i) => {
              const labels: Record<string, string> = { artist: 'Artist', title: 'Title', label: 'Label', catalog_number: 'Cat No.', year: 'Year' };
              return (
                <div key={key} className={`flex items-center ${i < 4 ? 'border-b border-neutral-200' : ''}`}>
                  <div className="w-20 px-3 py-2.5 border-r border-neutral-200 bg-neutral-50 shrink-0 lg:w-24">
                    <p className="text-[8px] uppercase tracking-widest font-medium text-neutral-500">{labels[key]}</p>
                  </div>
                  <input
                    type={key === 'year' ? 'number' : 'text'}
                    value={meta[key]}
                    onChange={(e) => setMeta(prev => ({ ...prev, [key]: e.target.value }))}
                    className="flex-1 px-3 py-2.5 text-xs text-black bg-white focus:outline-none placeholder:text-neutral-300 min-w-0"
                  />
                </div>
              );
            })}
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
              Retry Visual Search
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
    </div>
  );
}
