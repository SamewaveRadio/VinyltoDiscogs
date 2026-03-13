import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { VinylRecord, DiscogsCandidate, RecordPhoto } from '../types';
import MatchDetailView from '../components/MatchDetailView';
import ConfidenceBadge from '../components/ConfidenceBadge';

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
  const [addedRecord, setAddedRecord] = useState<VinylRecord | null>(null);
  const [addedCandidate, setAddedCandidate] = useState<DiscogsCandidate | null>(null);

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
    setAddedRecord(null);
    setAddedCandidate(null);

    const [{ data: cands }, { data: ph }] = await Promise.all([
      supabase.from('discogs_candidates').select('*').eq('record_id', record.id).order('score', { ascending: false }),
      supabase.from('record_photos').select('*').eq('record_id', record.id),
    ]);

    setCandidates(cands ?? []);
    setPhotos(ph ?? []);
  };

  const handleRecordAdded = (record: VinylRecord, candidate: DiscogsCandidate) => {
    setAddedRecord(record);
    setAddedCandidate(candidate);
    setRecords(prev => prev.filter(r => r.id !== record.id));
  };

  const handleRecordRemoved = (recordId: string) => {
    setRecords(prev => prev.filter(r => r.id !== recordId));
    setSelectedRecord(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" />
      </div>
    );
  }

  if (addedRecord && addedCandidate) {
    return (
      <SuccessView
        record={addedRecord}
        candidate={addedCandidate}
        onScanNext={() => {
          setAddedRecord(null);
          setAddedCandidate(null);
          setSelectedRecord(null);
          onNavigate('upload');
        }}
        onBackToQueue={() => {
          setAddedRecord(null);
          setAddedCandidate(null);
          setSelectedRecord(null);
          onNavigate('dashboard');
        }}
      />
    );
  }

  if (selectedRecord) {
    return (
      <MatchDetailView
        record={selectedRecord}
        candidates={candidates}
        photos={photos}
        setCandidates={setCandidates}
        setSelectedRecord={setSelectedRecord}
        onRecordAdded={handleRecordAdded}
        onRecordRemoved={handleRecordRemoved}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div>
      <div className="border-b border-black px-4 py-3 flex items-center gap-3 lg:px-8 lg:py-4 lg:gap-4">
        <button onClick={() => onNavigate('dashboard')} className="text-neutral-400 hover:text-black transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-baseline gap-2 lg:gap-4">
          <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black">Match Review</h1>
          <span className="text-[10px] text-neutral-400 uppercase tracking-wider">{records.length} pending</span>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 lg:py-32">
          <CheckCircle2 className="w-6 h-6 text-neutral-300 mb-3" strokeWidth={1} />
          <p className="text-[10px] uppercase tracking-widest text-neutral-400">No matches pending</p>
        </div>
      ) : (
        <div>
          <div className="hidden lg:grid grid-cols-[1fr_120px_100px_70px_130px] px-8 py-2 border-b border-neutral-200 bg-neutral-50">
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
              className="px-4 py-3 border-b border-neutral-100 cursor-pointer active:bg-neutral-50 lg:grid lg:grid-cols-[1fr_120px_100px_70px_130px] lg:items-center lg:px-8 lg:hover:bg-neutral-50 transition-colors"
            >
              <div className="min-w-0 lg:pr-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-black truncate">{record.artist ?? '---'}</span>
                  {record.title && (
                    <><span className="text-neutral-300 text-xs shrink-0">/</span>
                      <span className="text-xs text-neutral-600 truncate">{record.title}</span></>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 lg:hidden">
                  {record.confidence !== null && record.confidence !== undefined && (
                    <ConfidenceBadge score={record.confidence} />
                  )}
                  {record.label && <span className="text-[10px] text-neutral-400 truncate">{record.label}</span>}
                </div>
              </div>
              <div className="hidden lg:block text-[11px] text-neutral-500 truncate pr-2">{record.label ?? '---'}</div>
              <div className="hidden lg:block text-[11px] text-neutral-500 font-mono truncate pr-2">{record.catalog_number ?? '---'}</div>
              <div className="hidden lg:block text-[11px] text-neutral-500">{record.year ?? '---'}</div>
              <div className="hidden lg:block">
                {record.confidence !== null && record.confidence !== undefined && (
                  <ConfidenceBadge score={record.confidence} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SuccessViewProps {
  record: VinylRecord;
  candidate: DiscogsCandidate;
  onScanNext: () => void;
  onBackToQueue: () => void;
}

function SuccessView({ record, candidate, onScanNext, onBackToQueue }: SuccessViewProps) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 lg:min-h-screen lg:px-8">
      <div className="w-full max-w-sm border border-black">
        <div className="border-b border-black px-4 py-3 bg-black lg:px-6">
          <p className="text-[9px] uppercase tracking-widest font-semibold text-white">Added to Discogs</p>
        </div>
        <div className="px-4 py-5 border-b border-black space-y-3 lg:px-6 lg:py-6">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-neutral-400 mb-1">Artist / Title</p>
            <p className="text-sm font-medium text-black">
              {record.artist ?? '---'}{record.title ? ` / ${record.title}` : ''}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 lg:gap-4">
            <div>
              <p className="text-[9px] uppercase tracking-widest text-neutral-400 mb-1">Label</p>
              <p className="text-xs text-black font-medium truncate">{candidate.label ?? '---'}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-neutral-400 mb-1">Cat No.</p>
              <p className="text-xs text-black font-mono truncate">{candidate.catno ?? '---'}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-neutral-400 mb-1">Year</p>
              <p className="text-xs text-black font-medium">{candidate.year ?? '---'}</p>
            </div>
          </div>
          {candidate.score !== undefined && (
            <div className="pt-1">
              <ConfidenceBadge score={candidate.score} />
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row">
          <button
            onClick={onBackToQueue}
            className="flex-1 px-4 py-3 text-[9px] font-semibold uppercase tracking-widest text-neutral-500 hover:bg-neutral-50 hover:text-black transition-colors border-b border-black sm:border-b-0 sm:border-r"
          >
            Back to Queue
          </button>
          <button
            onClick={onScanNext}
            className="flex-1 px-4 py-3 text-[9px] font-semibold uppercase tracking-widest bg-black text-white hover:bg-neutral-800 transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3 h-3" />
            Scan Next
          </button>
        </div>
      </div>
    </div>
  );
}
