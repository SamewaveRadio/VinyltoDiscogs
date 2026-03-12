import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, ExternalLink, ChevronDown, ChevronUp, CreditCard as Edit2, AlertTriangle, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { VinylRecord, DiscogsCandidate, RecordPhoto } from '../types';

type Screen = 'dashboard' | 'upload' | 'processing' | 'match-review' | 'needs-review' | 'settings';

interface MatchReviewProps {
  onNavigate: (screen: Screen, recordId?: string) => void;
  recordId: string | null;
}

export default function MatchReview({ onNavigate, recordId }: MatchReviewProps) {
  const { user } = useAuth();
  const [records, setRecords] = useState<VinylRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState<VinylRecord | null>(null);
  const [candidates, setCandidates] = useState<DiscogsCandidate[]>([]);
  const [photos, setPhotos] = useState<RecordPhoto[]>([]);
  const [chosenCandidateId, setChosenCandidateId] = useState<string | null>(null);
  const [activePhotoUrl, setActivePhotoUrl] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaEdits, setMetaEdits] = useState({ artist: '', title: '', label: '', catalog_number: '', year: '' });
  const [savingMeta, setSavingMeta] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('records')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'matched')
        .order('created_at', { ascending: false });
      const recs = data ?? [];
      setRecords(recs);

      if (recordId) {
        const target = recs.find(r => r.id === recordId);
        if (target) await openRecord(target);
      }
      setLoading(false);
    })();
  }, [user, recordId]);

  const openRecord = async (record: VinylRecord) => {
    setSelectedRecord(record);
    setAddError(null);
    setAddSuccess(false);
    setEditingMeta(false);
    setMetaEdits({
      artist: record.artist ?? '',
      title: record.title ?? '',
      label: record.label ?? '',
      catalog_number: record.catalog_number ?? '',
      year: record.year ? String(record.year) : '',
    });

    const [{ data: cands }, { data: ph }] = await Promise.all([
      supabase.from('discogs_candidates').select('*').eq('record_id', record.id).order('score', { ascending: false }),
      supabase.from('record_photos').select('*').eq('record_id', record.id),
    ]);

    const candidateList = cands ?? [];
    setCandidates(candidateList);
    setPhotos(ph ?? []);
    if (ph && ph.length > 0) setActivePhotoUrl(ph[0].file_url);

    const preSelected = candidateList.find(c => c.is_selected);
    setChosenCandidateId(preSelected?.id ?? candidateList[0]?.id ?? null);
  };

  const handleAddToDiscogs = async () => {
    if (!selectedRecord || !chosenCandidateId) return;
    const candidate = candidates.find(c => c.id === chosenCandidateId);
    if (!candidate) return;

    setAdding(true);
    setAddError(null);

    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

    const response = await fetch(`${supabaseUrl}/functions/v1/add-to-discogs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        record_id: selectedRecord.id,
        release_id: candidate.discogs_release_id,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      setAddError(result.error ?? 'Failed to add to Discogs.');
      setAdding(false);
      return;
    }

    setAddSuccess(true);
    setAdding(false);
    setRecords(prev => prev.filter(r => r.id !== selectedRecord.id));

    setTimeout(() => {
      setSelectedRecord(null);
      setCandidates([]);
      setPhotos([]);
      onNavigate('dashboard');
    }, 1500);
  };

  const handleConfirmOnly = async () => {
    if (!selectedRecord || !chosenCandidateId) return;
    const candidate = candidates.find(c => c.id === chosenCandidateId);
    if (!candidate) return;

    await supabase.from('discogs_candidates').update({ is_selected: false }).eq('record_id', selectedRecord.id);
    await supabase.from('discogs_candidates').update({ is_selected: true }).eq('id', candidate.id);
    await supabase.from('records').update({
      status: 'added',
      selected_release_id: candidate.discogs_release_id,
      selected_release_title: candidate.title,
      selected_release_score: candidate.score,
    }).eq('id', selectedRecord.id);

    setRecords(prev => prev.filter(r => r.id !== selectedRecord.id));
    setSelectedRecord(null);
    onNavigate('dashboard');
  };

  const handleSendToReview = async () => {
    if (!selectedRecord) return;
    await supabase.from('records').update({ status: 'needs_review' }).eq('id', selectedRecord.id);
    setRecords(prev => prev.filter(r => r.id !== selectedRecord.id));
    setSelectedRecord(null);
    onNavigate('needs-review', selectedRecord.id);
  };

  const handleSaveMeta = async () => {
    if (!selectedRecord) return;
    setSavingMeta(true);
    const year = metaEdits.year ? parseInt(metaEdits.year, 10) : null;
    await supabase.from('records').update({
      artist: metaEdits.artist || null,
      title: metaEdits.title || null,
      label: metaEdits.label || null,
      catalog_number: metaEdits.catalog_number || null,
      year: year && !isNaN(year) ? year : null,
    }).eq('id', selectedRecord.id);
    setSelectedRecord(prev => prev ? {
      ...prev,
      artist: metaEdits.artist || null,
      title: metaEdits.title || null,
      label: metaEdits.label || null,
      catalog_number: metaEdits.catalog_number || null,
      year: year && !isNaN(year) ? year : null,
    } : prev);
    setSavingMeta(false);
    setEditingMeta(false);
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
      <div className="min-h-screen">
        <div className="border-b border-black px-8 py-4 flex items-center gap-4">
          <button onClick={() => onNavigate('dashboard')} className="text-neutral-400 hover:text-black transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-baseline gap-4">
            <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black">Match Review</h1>
            <span className="text-[10px] text-neutral-400 uppercase tracking-wider">{records.length} pending</span>
          </div>
        </div>

        {records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32">
            <CheckCircle2 className="w-6 h-6 text-neutral-300 mb-3" strokeWidth={1} />
            <p className="text-[10px] uppercase tracking-widest text-neutral-400">No matches pending</p>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[1fr_120px_100px_80px_80px] px-8 py-2 border-b border-neutral-200 bg-neutral-50">
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Artist / Title</p>
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Label</p>
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Cat No.</p>
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Year</p>
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Confidence</p>
            </div>
            {records.map((record) => (
              <div
                key={record.id}
                onClick={() => openRecord(record)}
                className="grid grid-cols-[1fr_120px_100px_80px_80px] items-center px-8 py-3 border-b border-neutral-100 cursor-pointer hover:bg-neutral-50 transition-colors"
              >
                <div className="min-w-0 pr-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium text-black truncate">{record.artist ?? '—'}</span>
                    {record.title && (
                      <><span className="text-neutral-300 text-xs shrink-0">/</span>
                        <span className="text-xs text-neutral-600 truncate">{record.title}</span></>
                    )}
                  </div>
                </div>
                <div className="text-[11px] text-neutral-500 truncate pr-2">{record.label ?? '—'}</div>
                <div className="text-[11px] text-neutral-500 font-mono truncate pr-2">{record.catalog_number ?? '—'}</div>
                <div className="text-[11px] text-neutral-500">{record.year ?? '—'}</div>
                <div>
                  {record.confidence !== null && (
                    <span className={`text-[11px] font-medium ${record.confidence >= 80 ? 'text-black' : record.confidence >= 50 ? 'text-neutral-500' : 'text-neutral-400'}`}>
                      {record.confidence}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const chosenCandidate = candidates.find(c => c.id === chosenCandidateId);

  return (
    <div className="min-h-screen flex flex-col">
      <div className="border-b border-black px-8 py-4 flex items-center gap-4">
        <button
          onClick={() => setSelectedRecord(null)}
          className="text-neutral-400 hover:text-black transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-baseline gap-4 min-w-0 flex-1">
          <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black shrink-0">Match Review</h1>
          <span className="text-[10px] text-neutral-400 uppercase tracking-wider truncate">
            {selectedRecord.artist ?? '—'} / {selectedRecord.title ?? 'Untitled'}
          </span>
        </div>
        <div className="flex items-center gap-0 border border-black shrink-0">
          <button
            onClick={handleSendToReview}
            className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-neutral-500 hover:bg-neutral-100 hover:text-black transition-colors border-r border-black flex items-center gap-1.5"
          >
            <AlertTriangle className="w-3 h-3" />
            Needs Review
          </button>
          <button
            onClick={handleConfirmOnly}
            disabled={!chosenCandidate}
            className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-neutral-500 hover:bg-neutral-100 hover:text-black transition-colors border-r border-black disabled:opacity-40"
          >
            Confirm Only
          </button>
          <button
            onClick={handleAddToDiscogs}
            disabled={!chosenCandidate || adding || addSuccess}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-black text-white text-[9px] font-semibold uppercase tracking-widest hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {adding ? <Loader2 className="w-3 h-3 animate-spin" /> :
             addSuccess ? <CheckCircle2 className="w-3 h-3" /> :
             <Plus className="w-3 h-3" />}
            {addSuccess ? 'Added!' : 'Add to Discogs'}
          </button>
        </div>
      </div>

      {addError && (
        <div className="border-b border-black px-8 py-2 bg-neutral-50 flex items-center gap-2">
          <XCircle className="w-3 h-3 text-black shrink-0" />
          <p className="text-[10px] text-black">{addError}</p>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden" style={{ height: 'calc(100vh - 53px)' }}>
        <div className="w-72 border-r border-black flex flex-col shrink-0 overflow-y-auto">
          <div className="border-b border-black px-4 py-2 bg-neutral-50 sticky top-0 z-10">
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Photos</p>
          </div>

          <div className="p-4 border-b border-black">
            {activePhotoUrl ? (
              <div className="aspect-square bg-neutral-100 border border-neutral-200 mb-3">
                <img src={activePhotoUrl} alt="Active" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="aspect-square bg-neutral-50 border border-neutral-200 flex items-center justify-center mb-3">
                <p className="text-[9px] uppercase tracking-widest text-neutral-300">No photo</p>
              </div>
            )}
            {photos.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {photos.map((photo) => (
                  <button
                    key={photo.id}
                    onClick={() => setActivePhotoUrl(photo.file_url)}
                    className={`w-10 h-10 border overflow-hidden transition-colors ${activePhotoUrl === photo.file_url ? 'border-black' : 'border-neutral-200 hover:border-neutral-400'}`}
                  >
                    <img src={photo.file_url} alt={photo.photo_type} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="px-4 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Extracted Metadata</p>
              <button
                onClick={() => setEditingMeta(!editingMeta)}
                className="text-neutral-400 hover:text-black transition-colors"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </div>

            {editingMeta ? (
              <div className="space-y-0 border border-black mb-3">
                {[
                  { key: 'artist', label: 'Artist' },
                  { key: 'title', label: 'Title' },
                  { key: 'label', label: 'Label' },
                  { key: 'catalog_number', label: 'Cat No.' },
                  { key: 'year', label: 'Year' },
                ].map(({ key, label }, i) => (
                  <div key={key} className={`flex items-center ${i < 4 ? 'border-b border-neutral-200' : ''}`}>
                    <div className="w-16 px-2 py-1.5 border-r border-neutral-200 bg-neutral-50 shrink-0">
                      <p className="text-[8px] uppercase tracking-widest font-medium text-neutral-500">{label}</p>
                    </div>
                    <input
                      type={key === 'year' ? 'number' : 'text'}
                      value={metaEdits[key as keyof typeof metaEdits]}
                      onChange={(e) => setMetaEdits(prev => ({ ...prev, [key]: e.target.value }))}
                      className="flex-1 px-2 py-1.5 text-[11px] text-black bg-white focus:outline-none placeholder:text-neutral-300"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { label: 'Artist', value: selectedRecord.artist },
                  { label: 'Title', value: selectedRecord.title },
                  { label: 'Label', value: selectedRecord.label },
                  { label: 'Cat No.', value: selectedRecord.catalog_number },
                  { label: 'Year', value: selectedRecord.year?.toString() },
                ].map(({ label, value }) => (
                  <div key={label} className="grid grid-cols-[48px_1fr] gap-2 items-baseline">
                    <span className="text-[9px] uppercase tracking-wider text-neutral-400">{label}</span>
                    <span className="text-[11px] text-black font-medium truncate">{value ?? '—'}</span>
                  </div>
                ))}
                {selectedRecord.confidence !== null && (
                  <div className="grid grid-cols-[48px_1fr] gap-2 items-baseline pt-2 border-t border-neutral-100">
                    <span className="text-[9px] uppercase tracking-wider text-neutral-400">Conf.</span>
                    <span className={`text-[11px] font-semibold ${selectedRecord.confidence >= 80 ? 'text-black' : selectedRecord.confidence >= 50 ? 'text-neutral-500' : 'text-neutral-400'}`}>
                      {selectedRecord.confidence}%
                    </span>
                  </div>
                )}
              </div>
            )}

            {editingMeta && (
              <div className="flex gap-0 border border-black mt-2">
                <button
                  onClick={handleSaveMeta}
                  disabled={savingMeta}
                  className="flex-1 py-1.5 bg-black text-white text-[9px] font-semibold uppercase tracking-widest hover:bg-neutral-800 disabled:opacity-50 transition-colors border-r border-neutral-700"
                >
                  {savingMeta ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Save'}
                </button>
                <button
                  onClick={() => setEditingMeta(false)}
                  className="flex-1 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-neutral-500 hover:bg-neutral-100 hover:text-black transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b border-black px-6 py-2 bg-neutral-50 flex items-center justify-between">
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">
              Discogs Candidates — {candidates.length} found
            </p>
            {chosenCandidate && (
              <p className="text-[9px] uppercase tracking-widest text-neutral-500 truncate max-w-xs">
                Selected: {chosenCandidate.title}
              </p>
            )}
          </div>

          <div className="border-b border-neutral-100 px-6 py-1.5 bg-neutral-50">
            <div className="grid grid-cols-[20px_1fr_80px_80px_70px_70px_60px_52px]">
              <p className="text-[8px] uppercase tracking-widest text-neutral-300"></p>
              <p className="text-[8px] uppercase tracking-widest text-neutral-400">Title / Label</p>
              <p className="text-[8px] uppercase tracking-widest text-neutral-400">Cat No.</p>
              <p className="text-[8px] uppercase tracking-widest text-neutral-400">Year</p>
              <p className="text-[8px] uppercase tracking-widest text-neutral-400">Country</p>
              <p className="text-[8px] uppercase tracking-widest text-neutral-400">Format</p>
              <p className="text-[8px] uppercase tracking-widest text-neutral-400">Score</p>
              <p className="text-[8px] uppercase tracking-widest text-neutral-400"></p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {candidates.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <p className="text-[10px] uppercase tracking-widest text-neutral-400">No candidates found</p>
              </div>
            ) : (
              candidates.map((candidate) => (
                <CandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  isChosen={chosenCandidateId === candidate.id}
                  onSelect={() => setChosenCandidateId(candidate.id)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function XCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

interface CandidateRowProps {
  candidate: DiscogsCandidate;
  isChosen: boolean;
  onSelect: () => void;
}

function CandidateRow({ candidate, isChosen, onSelect }: CandidateRowProps) {
  const [expanded, setExpanded] = useState(false);
  const discogsUrl = `https://www.discogs.com/release/${candidate.discogs_release_id}`;

  return (
    <div className={`border-b border-neutral-100 transition-colors ${isChosen ? 'bg-black' : 'hover:bg-neutral-50'}`}>
      <div
        onClick={onSelect}
        className="grid grid-cols-[20px_1fr_80px_80px_70px_70px_60px_52px] items-center px-6 py-3 cursor-pointer"
      >
        <div className={`w-3.5 h-3.5 border flex items-center justify-center shrink-0 ${isChosen ? 'border-white' : 'border-neutral-300'}`}>
          {isChosen && <div className="w-2 h-2 bg-white" />}
        </div>
        <div className="min-w-0 pr-3">
          <span className={`text-[11px] font-medium truncate block ${isChosen ? 'text-white' : 'text-black'}`}>{candidate.title ?? '—'}</span>
          {candidate.label && (
            <span className={`text-[10px] truncate block mt-0.5 ${isChosen ? 'text-neutral-400' : 'text-neutral-500'}`}>{candidate.label}</span>
          )}
        </div>
        <div className={`text-[10px] font-mono truncate pr-2 ${isChosen ? 'text-neutral-400' : 'text-neutral-500'}`}>{candidate.catno ?? '—'}</div>
        <div className={`text-[10px] ${isChosen ? 'text-neutral-400' : 'text-neutral-500'}`}>{candidate.year ?? '—'}</div>
        <div className={`text-[10px] ${isChosen ? 'text-neutral-400' : 'text-neutral-500'}`}>{candidate.country ?? '—'}</div>
        <div className={`text-[10px] ${isChosen ? 'text-neutral-400' : 'text-neutral-500'}`}>{candidate.format ?? '—'}</div>
        <div className={`text-[10px] font-semibold ${isChosen ? 'text-white' : 'text-black'}`}>{candidate.score}</div>
        <div className="flex items-center gap-2 justify-end">
          <a
            href={discogsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`transition-colors ${isChosen ? 'text-neutral-500 hover:text-white' : 'text-neutral-300 hover:text-black'}`}
          >
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className={`transition-colors ${isChosen ? 'text-neutral-500 hover:text-white' : 'text-neutral-300 hover:text-black'}`}
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>
      {expanded && candidate.reasons_json && candidate.reasons_json.length > 0 && (
        <div className="px-6 pb-3 flex flex-wrap gap-1.5">
          {candidate.reasons_json.map((reason, i) => (
            <span
              key={i}
              className={`text-[9px] uppercase tracking-widest px-2 py-0.5 border ${isChosen ? 'border-neutral-700 text-neutral-400' : 'border-neutral-200 text-neutral-500'}`}
            >
              {reason}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
