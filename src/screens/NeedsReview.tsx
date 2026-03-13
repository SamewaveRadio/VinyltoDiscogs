import { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, Loader2, RefreshCw, CheckCircle2, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { VinylRecord, RecordPhoto } from '../types';

type Screen = 'dashboard' | 'upload' | 'processing' | 'match-review' | 'needs-review' | 'settings';

type ReviewFilter = 'all' | 'no_match' | 'low_confidence' | 'failed' | 'manual';
type SortOption = 'newest' | 'oldest';

interface NeedsReviewProps {
  onNavigate: (screen: Screen, recordId?: string) => void;
  recordId: string | null;
}

function getReviewReason(record: VinylRecord): string {
  if (record.error_message?.toLowerCase().includes('no matching')) return 'No Match';
  if (record.error_message?.toLowerCase().includes('no discogs token')) return 'No Token';
  if (record.error_message?.toLowerCase().includes('failed')) return 'Processing Failed';
  if (record.confidence !== null && record.confidence < 50) return 'Low Confidence';
  return 'Manual Review';
}

function getReviewFilterKey(record: VinylRecord): ReviewFilter {
  const reason = getReviewReason(record);
  if (reason === 'No Match' || reason === 'No Token') return 'no_match';
  if (reason === 'Low Confidence') return 'low_confidence';
  if (reason === 'Processing Failed') return 'failed';
  return 'manual';
}

const FILTER_LABELS: Record<ReviewFilter, string> = {
  all: 'All',
  no_match: 'No Match',
  low_confidence: 'Low Confidence',
  failed: 'Failed',
  manual: 'Manual',
};

interface RecordWithThumb extends VinylRecord {
  thumbUrl?: string;
}

export default function NeedsReview({ onNavigate, recordId }: NeedsReviewProps) {
  const { user } = useAuth();
  const [records, setRecords] = useState<RecordWithThumb[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState<VinylRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ artist: '', title: '', label: '', catalog_number: '', year: '' });
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [sort, setSort] = useState<SortOption>('newest');

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

      const thumbMap: Record<string, string> = {};
      if (recs.length > 0) {
        const { data: photos } = await supabase
          .from('record_photos')
          .select('record_id, photo_type, file_url')
          .in('record_id', recs.map(r => r.id));
        if (photos) {
          for (const photo of photos) {
            if (!thumbMap[photo.record_id]) thumbMap[photo.record_id] = photo.file_url;
            if (photo.photo_type === 'cover_front') thumbMap[photo.record_id] = photo.file_url;
          }
        }
      }

      const enriched = recs.map(r => ({ ...r, thumbUrl: thumbMap[r.id] }));
      setRecords(enriched);

      if (recordId) {
        const target = enriched.find(r => r.id === recordId);
        if (target) openRecord(target);
      }
      setLoading(false);
    })();
  }, [user, recordId]);

  const filteredRecords = useMemo(() => {
    let filtered = records;
    if (filter !== 'all') {
      filtered = filtered.filter(r => getReviewFilterKey(r) === filter);
    }
    if (sort === 'oldest') {
      filtered = [...filtered].reverse();
    }
    return filtered;
  }, [records, filter, sort]);

  const filterCounts = useMemo(() => {
    const counts: Record<ReviewFilter, number> = { all: records.length, no_match: 0, low_confidence: 0, failed: 0, manual: 0 };
    records.forEach(r => { counts[getReviewFilterKey(r)]++; });
    return counts;
  }, [records]);

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

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/search-discogs`, {
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
      setRecords(prev => prev.filter(r => r.id !== selectedRecord.id));
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

  if (selectedRecord) {
    return (
      <div>
        <div className="border-b border-black px-4 py-3 flex items-center gap-3 lg:px-8 lg:py-4 lg:gap-4">
          <button onClick={() => setSelectedRecord(null)} className="text-neutral-400 hover:text-black transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-baseline gap-2 min-w-0 flex-1 lg:gap-4">
            <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black shrink-0">Review</h1>
            <span className="text-[10px] text-neutral-400 uppercase tracking-wider truncate hidden sm:inline">
              {selectedRecord.artist ?? '---'} / {selectedRecord.title ?? 'Untitled'}
            </span>
          </div>
        </div>

        <div className="px-4 py-6 lg:px-8 lg:py-8 lg:max-w-lg">
          {selectedRecord.error_message && (
            <div className="border border-neutral-300 px-3 py-2 mb-4 bg-neutral-50">
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400 mb-1">Reason</p>
              <p className="text-[10px] text-neutral-600">{selectedRecord.error_message}</p>
            </div>
          )}

          <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400 mb-4">
            Edit Metadata
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

      <div className="border-b border-neutral-200 px-4 py-2 flex items-center gap-3 overflow-x-auto lg:px-8">
        <div className="flex items-center gap-1 shrink-0">
          {(Object.keys(FILTER_LABELS) as ReviewFilter[]).map((f) => {
            const count = filterCounts[f];
            if (f !== 'all' && count === 0) return null;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[9px] uppercase tracking-widest px-2 py-1 border transition-colors whitespace-nowrap ${
                  filter === f
                    ? 'border-black text-black bg-black text-white'
                    : 'border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600'
                }`}
              >
                {FILTER_LABELS[f]} {count > 0 && <span className="ml-1">{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="ml-auto shrink-0">
          <button
            onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')}
            className="text-[9px] uppercase tracking-widest text-neutral-400 hover:text-black transition-colors"
          >
            {sort === 'newest' ? 'Newest' : 'Oldest'}
          </button>
        </div>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 lg:py-32">
          <CheckCircle2 className="w-6 h-6 text-neutral-300 mb-3" strokeWidth={1} />
          <p className="text-[10px] uppercase tracking-widest text-neutral-400">
            {records.length === 0 ? 'No records need review' : 'No records match this filter'}
          </p>
        </div>
      ) : (
        <div>
          <div className="hidden lg:grid grid-cols-[40px_1fr_100px_80px_120px_100px_36px] px-8 py-2 border-b border-neutral-200 bg-neutral-50">
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400" />
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Artist / Title</p>
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Label</p>
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Confidence</p>
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Reason</p>
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Updated</p>
            <p />
          </div>
          {filteredRecords.map((record) => (
            <ReviewRow key={record.id} record={record} onOpen={() => openRecord(record)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewRow({ record, onOpen }: { record: RecordWithThumb; onOpen: () => void }) {
  const reason = getReviewReason(record);
  const updated = new Date(record.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <>
      <div
        onClick={onOpen}
        className="flex items-center gap-3 px-4 py-3 border-b border-neutral-100 cursor-pointer active:bg-neutral-50 lg:hidden"
      >
        <div className="w-10 h-10 border border-neutral-200 overflow-hidden bg-neutral-50 shrink-0">
          {record.thumbUrl ? (
            <img src={record.thumbUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-neutral-100" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-xs font-medium text-black truncate">{record.artist ?? '---'}</span>
            {record.title && (
              <>
                <span className="text-neutral-300 text-xs shrink-0">/</span>
                <span className="text-xs text-neutral-600 truncate">{record.title}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[9px] uppercase tracking-widest font-medium text-neutral-500 border border-neutral-300 px-1.5 py-0.5">
              {reason}
            </span>
            {record.confidence !== null && (
              <span className="text-[10px] text-neutral-400">{record.confidence}%</span>
            )}
            <span className="text-[10px] text-neutral-300">{updated}</span>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-neutral-300 shrink-0" />
      </div>

      <div
        onClick={onOpen}
        className="hidden lg:grid grid-cols-[40px_1fr_100px_80px_120px_100px_36px] items-center px-8 py-2.5 border-b border-neutral-100 cursor-pointer hover:bg-neutral-50 transition-colors group"
      >
        <div className="w-7 h-7 border border-neutral-200 overflow-hidden bg-neutral-50 shrink-0">
          {record.thumbUrl ? (
            <img src={record.thumbUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-neutral-100" />
          )}
        </div>
        <div className="min-w-0 pr-4">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-black truncate">{record.artist ?? '---'}</span>
            {record.title && (
              <>
                <span className="text-neutral-300 text-xs shrink-0">/</span>
                <span className="text-xs text-neutral-600 truncate">{record.title}</span>
              </>
            )}
          </div>
        </div>
        <div className="text-[11px] text-neutral-500 truncate pr-2">{record.label ?? '---'}</div>
        <div className="text-[11px] text-neutral-500">
          {record.confidence !== null ? `${record.confidence}%` : '---'}
        </div>
        <div>
          <span className="text-[9px] uppercase tracking-widest font-medium text-neutral-500 border border-neutral-300 px-1.5 py-0.5">
            {reason}
          </span>
        </div>
        <div className="text-[10px] text-neutral-400">{updated}</div>
        <div className="flex justify-end">
          <ChevronRight className="w-3.5 h-3.5 text-neutral-300 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </>
  );
}
