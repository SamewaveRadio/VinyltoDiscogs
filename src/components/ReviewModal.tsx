import { useEffect, useState, useCallback } from 'react';
import { X, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { VinylRecord, DiscogsCandidate, RecordPhoto } from '../types';
import MatchDetailView from './MatchDetailView';
import NeedsReviewPanel from './NeedsReviewPanel';

interface ReviewModalProps {
  record: VinylRecord;
  onClose: () => void;
  onRecordUpdated: (record: VinylRecord) => void;
}

export default function ReviewModal({ record, onClose, onRecordUpdated }: ReviewModalProps) {
  const [candidates, setCandidates] = useState<DiscogsCandidate[]>([]);
  const [photos, setPhotos] = useState<RecordPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentRecord, setCurrentRecord] = useState<VinylRecord>(record);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: cands }, { data: ph }] = await Promise.all([
      supabase.from('discogs_candidates').select('*').eq('record_id', record.id).order('visual_score', { ascending: false }),
      supabase.from('record_photos').select('*').eq('record_id', record.id),
    ]);
    setCandidates(cands ?? []);
    setPhotos(ph ?? []);
    setLoading(false);
  }, [record.id]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleRecordUpdated = (updatedRecord: VinylRecord) => {
    setCurrentRecord(updatedRecord);
    onRecordUpdated(updatedRecord);
    onClose();
  };

  const hasMatches = candidates.length > 0;
  const showMatchView = hasMatches && (currentRecord.status === 'matched' || currentRecord.status === 'needs_review');
  const showNeedsReview = !hasMatches || currentRecord.status === 'failed';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-5xl bg-white flex flex-col my-0 lg:my-6 lg:mx-6 lg:border lg:border-black overflow-hidden">
        <div className="absolute top-3 right-3 z-10 lg:top-4 lg:right-4">
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center bg-white border border-neutral-200 hover:border-black transition-colors"
          >
            <X className="w-3.5 h-3.5 text-neutral-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" />
          </div>
        ) : showMatchView ? (
          <div className="flex-1 overflow-y-auto">
            <MatchDetailView
              record={currentRecord}
              candidates={candidates}
              photos={photos}
              setCandidates={setCandidates}
              setSelectedRecord={(r) => { if (r) setCurrentRecord(r); }}
              onRecordUpdated={handleRecordUpdated}
              onClose={onClose}
            />
          </div>
        ) : showNeedsReview ? (
          <div className="flex-1 overflow-y-auto">
            <NeedsReviewPanel
              record={currentRecord}
              photos={photos}
              onRecordUpdated={handleRecordUpdated}
              onClose={onClose}
              onMatchFound={async () => {
                await loadData();
                const { data: rec } = await supabase.from('records').select('*').eq('id', record.id).maybeSingle();
                if (rec) setCurrentRecord(rec);
              }}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <MatchDetailView
              record={currentRecord}
              candidates={candidates}
              photos={photos}
              setCandidates={setCandidates}
              setSelectedRecord={(r) => { if (r) setCurrentRecord(r); }}
              onRecordUpdated={handleRecordUpdated}
              onClose={onClose}
            />
          </div>
        )}
      </div>
    </div>
  );
}
