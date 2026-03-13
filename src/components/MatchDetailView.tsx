import { useState } from 'react';
import {
  ArrowLeft, Loader2, ExternalLink, AlertTriangle,
  Plus, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { VinylRecord, DiscogsCandidate, RecordPhoto } from '../types';
import ConfidenceBadge, { getConfidenceTier } from './ConfidenceBadge';

type Screen = 'dashboard' | 'upload' | 'processing' | 'match-review' | 'needs-review' | 'settings';

interface MatchDetailViewProps {
  record: VinylRecord;
  candidates: DiscogsCandidate[];
  photos: RecordPhoto[];
  setCandidates: (c: DiscogsCandidate[]) => void;
  setSelectedRecord: (r: VinylRecord | null) => void;
  onRecordAdded: (record: VinylRecord, candidate: DiscogsCandidate) => void;
  onRecordRemoved: (recordId: string) => void;
  onNavigate: (screen: Screen, recordId?: string) => void;
}

export default function MatchDetailView({
  record, candidates, photos, setCandidates, setSelectedRecord,
  onRecordAdded, onRecordRemoved, onNavigate,
}: MatchDetailViewProps) {
  const [chosenCandidateId, setChosenCandidateId] = useState<string | null>(() => {
    const preSelected = candidates.find(c => c.is_selected);
    return (preSelected ?? candidates[0])?.id ?? null;
  });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingMeta, setEditingMeta] = useState(false);
  const [metaEdits, setMetaEdits] = useState({
    artist: record.artist ?? '',
    title: record.title ?? '',
    label: record.label ?? '',
    catalog_number: record.catalog_number ?? '',
    year: record.year ? String(record.year) : '',
  });
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const chosenCandidate = candidates.find(c => c.id === chosenCandidateId);
  const topCandidate = candidates[0] ?? null;
  const alternateCandidates = candidates.slice(1);

  const showLowConfWarning = topCandidate && getConfidenceTier(topCandidate.score) === 'low';

  const handleAddToDiscogs = async () => {
    if (!chosenCandidateId) return;
    const candidate = candidates.find(c => c.id === chosenCandidateId);
    if (!candidate) return;

    setAdding(true);
    setAddError(null);

    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/add-to-discogs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ record_id: record.id, release_id: candidate.discogs_release_id }),
    });

    const result = await response.json();
    if (!response.ok) {
      setAddError(result.error ?? 'Failed to add to Discogs.');
      setAdding(false);
      return;
    }

    setAdding(false);
    onRecordAdded(record, candidate);
  };

  const handleConfirmOnly = async () => {
    if (!chosenCandidateId) return;
    const candidate = candidates.find(c => c.id === chosenCandidateId);
    if (!candidate) return;

    await supabase.from('discogs_candidates').update({ is_selected: false }).eq('record_id', record.id);
    await supabase.from('discogs_candidates').update({ is_selected: true }).eq('id', candidate.id);
    await supabase.from('records').update({
      status: 'added',
      selected_release_id: candidate.discogs_release_id,
      selected_release_title: candidate.title,
      selected_release_score: candidate.score,
    }).eq('id', record.id);

    onRecordAdded(record, candidate);
  };

  const handleSendToReview = async () => {
    await supabase.from('records').update({ status: 'needs_review' }).eq('id', record.id);
    onRecordRemoved(record.id);
    onNavigate('needs-review', record.id);
  };

  const handleRetrySearch = async () => {
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
        artist: metaEdits.artist || null,
        title: metaEdits.title || null,
        label: metaEdits.label || null,
        catalog_number: metaEdits.catalog_number || null,
        year: metaEdits.year || null,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      setRetryError(result.error ?? 'Search failed.');
      setRetrying(false);
      return;
    }

    const yearNum = metaEdits.year ? parseInt(metaEdits.year, 10) : null;
    const updatedRecord: VinylRecord = {
      ...record,
      artist: metaEdits.artist || null,
      title: metaEdits.title || null,
      label: metaEdits.label || null,
      catalog_number: metaEdits.catalog_number || null,
      year: yearNum && !isNaN(yearNum) ? yearNum : null,
      status: result.status,
    };

    const { data: newCands } = await supabase
      .from('discogs_candidates')
      .select('*')
      .eq('record_id', record.id)
      .order('score', { ascending: false });

    const candidateList = newCands ?? [];
    setCandidates(candidateList);
    setSelectedRecord(updatedRecord);
    setEditingMeta(false);
    setRetrying(false);
    setChosenCandidateId(candidateList[0]?.id ?? null);
  };

  const coverPhoto = photos.find(p => p.photo_type === 'cover_front') ?? photos[0];

  return (
    <div className="flex flex-col">
      <div className="border-b border-black px-4 py-3 flex items-center gap-3 lg:px-8 lg:py-4 lg:gap-4">
        <button onClick={() => setSelectedRecord(null)} className="text-neutral-400 hover:text-black transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-baseline gap-2 min-w-0 flex-1 lg:gap-4">
          <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black shrink-0">Review</h1>
          <span className="text-[10px] text-neutral-400 uppercase tracking-wider truncate hidden sm:inline">
            {record.artist ?? '---'} / {record.title ?? 'Untitled'}
          </span>
        </div>
        <div className="hidden lg:flex items-center gap-0 border border-black shrink-0">
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
            disabled={!chosenCandidate || adding}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-black text-white text-[9px] font-semibold uppercase tracking-widest hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Add to Discogs
          </button>
        </div>
      </div>

      {addError && (
        <div className="border-b border-black px-4 py-2 bg-neutral-50 flex items-center gap-2 lg:px-8">
          <AlertTriangle className="w-3 h-3 text-black shrink-0" />
          <p className="text-[10px] text-black">{addError}</p>
        </div>
      )}

      {showLowConfWarning && !editingMeta && (
        <div className="border-b border-neutral-300 px-4 py-2 bg-neutral-50 flex items-center gap-2 lg:px-8">
          <AlertTriangle className="w-3 h-3 text-neutral-500 shrink-0" />
          <p className="text-[10px] text-neutral-600">
            Low confidence. Consider editing metadata and retrying.
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto lg:flex lg:overflow-hidden" style={{ minHeight: 0 }}>
        <div className="lg:w-80 lg:border-r lg:border-black lg:flex lg:flex-col lg:shrink-0 lg:overflow-y-auto">
          <div className="p-4 border-b border-black lg:p-5">
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400 mb-3">Photos</p>
            {photos.length > 0 ? (
              <div className="grid grid-cols-4 gap-1.5 lg:grid-cols-2 lg:gap-2">
                {photos.map((photo) => (
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
            ) : (
              <div className="aspect-video bg-neutral-50 border border-neutral-200 flex items-center justify-center">
                <p className="text-[9px] uppercase tracking-widest text-neutral-300">No photos</p>
              </div>
            )}
          </div>

          <div className="p-4 border-b border-black lg:border-b-0 lg:p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Extracted Metadata</p>
              <button
                onClick={() => { setEditingMeta(!editingMeta); setRetryError(null); }}
                className="text-[9px] uppercase tracking-widest text-neutral-400 hover:text-black transition-colors"
              >
                {editingMeta ? 'Cancel' : 'Edit'}
              </button>
            </div>

            {editingMeta ? (
              <div>
                <div className="border border-black mb-3">
                  {(['artist', 'title', 'label', 'catalog_number', 'year'] as const).map((key, i) => {
                    const labels: Record<string, string> = { artist: 'Artist', title: 'Title', label: 'Label', catalog_number: 'Cat No.', year: 'Year' };
                    return (
                      <div key={key} className={`flex items-center ${i < 4 ? 'border-b border-neutral-200' : ''}`}>
                        <div className="w-16 px-2 py-2 border-r border-neutral-200 bg-neutral-50 shrink-0">
                          <p className="text-[8px] uppercase tracking-widest font-medium text-neutral-500">{labels[key]}</p>
                        </div>
                        <input
                          type={key === 'year' ? 'number' : 'text'}
                          value={metaEdits[key]}
                          onChange={(e) => setMetaEdits(prev => ({ ...prev, [key]: e.target.value }))}
                          className="flex-1 px-2 py-2 text-xs text-black bg-white focus:outline-none placeholder:text-neutral-300 min-w-0"
                        />
                      </div>
                    );
                  })}
                </div>
                {retryError && <p className="text-[9px] text-neutral-500 mb-2">{retryError}</p>}
                <button
                  onClick={handleRetrySearch}
                  disabled={retrying}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-black text-white text-[9px] font-semibold uppercase tracking-widest hover:bg-neutral-800 disabled:opacity-50 transition-colors"
                >
                  {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {retrying ? 'Searching...' : 'Retry Search'}
                </button>
              </div>
            ) : (
              <div className="border border-neutral-200">
                {[
                  { label: 'Artist', value: record.artist },
                  { label: 'Title', value: record.title },
                  { label: 'Label', value: record.label },
                  { label: 'Cat No.', value: record.catalog_number },
                  { label: 'Year', value: record.year?.toString() },
                ].map(({ label, value }, i, arr) => (
                  <div key={label} className={`flex ${i < arr.length - 1 ? 'border-b border-neutral-100' : ''}`}>
                    <div className="w-16 px-2 py-1.5 border-r border-neutral-100 bg-neutral-50 shrink-0">
                      <p className="text-[8px] uppercase tracking-widest text-neutral-400">{label}</p>
                    </div>
                    <p className="flex-1 px-2 py-1.5 text-[11px] text-black font-medium truncate min-w-0">{value ?? '---'}</p>
                  </div>
                ))}
                {record.confidence !== null && record.confidence !== undefined && (
                  <div className="border-t border-neutral-100 px-2 py-2">
                    <ConfidenceBadge score={record.confidence} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {topCandidate && (
            <TopMatchCard
              candidate={topCandidate}
              isChosen={chosenCandidateId === topCandidate.id}
              onSelect={() => setChosenCandidateId(topCandidate.id)}
            />
          )}

          {alternateCandidates.length > 0 && (
            <>
              <div className="border-b border-black px-4 py-2 bg-neutral-50 lg:px-6">
                <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">
                  Alternate Matches --- {alternateCandidates.length}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {alternateCandidates.map((candidate) => (
                  <CandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    isChosen={chosenCandidateId === candidate.id}
                    onSelect={() => setChosenCandidateId(candidate.id)}
                  />
                ))}
              </div>
            </>
          )}

          {candidates.length === 0 && (
            <div className="flex items-center justify-center py-16 lg:py-20">
              <p className="text-[10px] uppercase tracking-widest text-neutral-400">No candidates found</p>
            </div>
          )}
        </div>
      </div>

      <div className="lg:hidden border-t border-black bg-white sticky bottom-16 z-40">
        <div className="flex">
          <button
            onClick={handleSendToReview}
            className="flex-1 py-3 text-[9px] font-semibold uppercase tracking-widest text-neutral-500 active:bg-neutral-100 border-r border-black flex items-center justify-center gap-1.5"
          >
            <AlertTriangle className="w-3 h-3" />
            Review
          </button>
          <button
            onClick={handleConfirmOnly}
            disabled={!chosenCandidate}
            className="flex-1 py-3 text-[9px] font-semibold uppercase tracking-widest text-neutral-500 active:bg-neutral-100 border-r border-black disabled:opacity-40"
          >
            Confirm
          </button>
          <button
            onClick={handleAddToDiscogs}
            disabled={!chosenCandidate || adding}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-black text-white text-[9px] font-semibold uppercase tracking-widest disabled:opacity-40"
          >
            {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function TopMatchCard({ candidate, isChosen, onSelect }: { candidate: DiscogsCandidate; isChosen: boolean; onSelect: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const discogsUrl = `https://www.discogs.com/release/${candidate.discogs_release_id}`;
  const tier = getConfidenceTier(candidate.score);

  return (
    <div className={`border-b border-black ${isChosen ? 'bg-black' : 'bg-neutral-50'}`}>
      <div className="px-4 py-2 flex items-center justify-between lg:px-6">
        <div className="flex items-center gap-2">
          <p className={`text-[9px] uppercase tracking-widest font-semibold ${isChosen ? 'text-white' : 'text-black'}`}>
            Top Match
          </p>
          <ConfidenceBadge score={candidate.score} />
        </div>
        <div className="flex items-center gap-2">
          <a
            href={discogsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`p-1 transition-colors ${isChosen ? 'text-neutral-500 hover:text-white' : 'text-neutral-400 hover:text-black'}`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <div onClick={onSelect} className="px-4 pb-4 cursor-pointer lg:px-6 lg:pb-5">
        <div className="flex items-start gap-3">
          <div className={`w-4 h-4 border flex items-center justify-center shrink-0 mt-0.5 ${isChosen ? 'border-white' : 'border-neutral-300'}`}>
            {isChosen && <div className="w-2.5 h-2.5 bg-white" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium truncate ${isChosen ? 'text-white' : 'text-black'}`}>
              {candidate.title ?? '---'}
            </p>
            {candidate.label && (
              <p className={`text-[11px] mt-0.5 truncate ${isChosen ? 'text-neutral-400' : 'text-neutral-500'}`}>
                {candidate.label}
              </p>
            )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 sm:grid-cols-4">
              {[
                { label: 'Cat No.', value: candidate.catno, mono: true },
                { label: 'Year', value: candidate.year?.toString() },
                { label: 'Country', value: candidate.country },
                { label: 'Format', value: candidate.format },
              ].map(({ label, value, mono }) => (
                <div key={label}>
                  <p className={`text-[8px] uppercase tracking-widest ${isChosen ? 'text-neutral-600' : 'text-neutral-400'}`}>{label}</p>
                  <p className={`text-[11px] ${mono ? 'font-mono' : ''} ${isChosen ? 'text-neutral-300' : 'text-neutral-700'}`}>
                    {value ?? '---'}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 mt-3">
              <span className={`text-[10px] font-semibold ${isChosen ? 'text-white' : 'text-black'}`}>
                Score: {candidate.score}
              </span>
              {candidate.visual_score !== null && (
                <span className={`text-[10px] font-medium ${
                  candidate.visual_score >= 70
                    ? isChosen ? 'text-white' : 'text-black'
                    : isChosen ? 'text-neutral-500' : 'text-neutral-500'
                }`}>
                  Visual: {candidate.visual_score}%
                </span>
              )}
              {tier !== 'strong' && (
                <span className={`text-[9px] uppercase tracking-widest ${isChosen ? 'text-neutral-500' : 'text-neutral-400'}`}>
                  {tier === 'review' ? 'Review Recommended' : 'Low Confidence'}
                </span>
              )}
            </div>
          </div>
        </div>

        {candidate.reasons_json && candidate.reasons_json.length > 0 && (
          <div className="mt-3 ml-7 flex flex-wrap gap-1.5">
            {candidate.reasons_json.map((reason, i) => (
              <span
                key={i}
                className={`text-[9px] uppercase tracking-widest px-2 py-0.5 border ${
                  isChosen ? 'border-neutral-700 text-neutral-400' : 'border-neutral-200 text-neutral-500'
                }`}
              >
                {reason}
              </span>
            ))}
          </div>
        )}

        {candidate.visual_reason && (
          <p className={`text-[10px] italic mt-2 ml-7 ${isChosen ? 'text-neutral-500' : 'text-neutral-400'}`}>
            Visual: {candidate.visual_reason}
          </p>
        )}
      </div>
    </div>
  );
}

function CandidateRow({ candidate, isChosen, onSelect }: { candidate: DiscogsCandidate; isChosen: boolean; onSelect: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const discogsUrl = `https://www.discogs.com/release/${candidate.discogs_release_id}`;

  const secondaryText = isChosen ? 'text-neutral-400' : 'text-neutral-500';

  return (
    <div className={`border-b border-neutral-100 transition-colors ${isChosen ? 'bg-black' : 'hover:bg-neutral-50'}`}>
      <div onClick={onSelect} className="flex items-start gap-3 px-4 py-3 cursor-pointer lg:px-6">
        <div className={`w-4 h-4 border flex items-center justify-center shrink-0 mt-0.5 ${isChosen ? 'border-white' : 'border-neutral-300'}`}>
          {isChosen && <div className="w-2.5 h-2.5 bg-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className={`text-xs font-medium truncate ${isChosen ? 'text-white' : 'text-black'}`}>{candidate.title ?? '---'}</span>
            <span className={`text-[10px] font-semibold shrink-0 ${isChosen ? 'text-white' : 'text-black'}`}>{candidate.score}</span>
          </div>
          {candidate.label && (
            <span className={`text-[10px] block truncate mt-0.5 ${secondaryText}`}>{candidate.label}</span>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
            {candidate.catno && <span className={`text-[10px] font-mono ${secondaryText}`}>{candidate.catno}</span>}
            {candidate.year && <span className={`text-[10px] ${secondaryText}`}>{candidate.year}</span>}
            {candidate.country && <span className={`text-[10px] ${secondaryText}`}>{candidate.country}</span>}
            {candidate.format && <span className={`text-[10px] ${secondaryText}`}>{candidate.format}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={discogsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`p-1 transition-colors ${isChosen ? 'text-neutral-500 hover:text-white' : 'text-neutral-300 hover:text-black'}`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className={`p-1 transition-colors ${isChosen ? 'text-neutral-500 hover:text-white' : 'text-neutral-300 hover:text-black'}`}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 ml-7 space-y-2 lg:px-6">
          {candidate.reasons_json && candidate.reasons_json.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {candidate.reasons_json.map((reason, i) => (
                <span
                  key={i}
                  className={`text-[9px] uppercase tracking-widest px-2 py-0.5 border ${
                    isChosen ? 'border-neutral-700 text-neutral-400' : 'border-neutral-200 text-neutral-500'
                  }`}
                >
                  {reason}
                </span>
              ))}
            </div>
          )}
          {candidate.visual_score !== null && (
            <p className={`text-[10px] ${isChosen ? 'text-neutral-500' : 'text-neutral-400'}`}>
              Visual: {candidate.visual_score}%{candidate.visual_reason ? ` --- ${candidate.visual_reason}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
