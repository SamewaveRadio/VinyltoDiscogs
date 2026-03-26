import { useEffect, useState, useRef, useCallback } from 'react';
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { RecordPhoto, RecordStatus } from '../types';

type Screen = 'dashboard' | 'upload' | 'processing' | 'match-review' | 'needs-review' | 'settings';

interface ProcessingScreenProps {
  recordId: string;
  onNavigate: (screen: Screen, recordId?: string) => void;
}

interface Step {
  id: string;
  label: string;
  sublabel: string;
}

const STEPS: Step[] = [
  { id: 'process',  label: 'Processing record',    sublabel: 'Preparing record for analysis' },
  { id: 'extract',  label: 'Extracting metadata',  sublabel: 'Reading artist, label, catalog number' },
  { id: 'search',   label: 'Searching Discogs',    sublabel: 'Querying release database' },
  { id: 'rank',     label: 'Ranking matches',       sublabel: 'Scoring candidates by relevance' },
];

type StepStatus = 'pending' | 'active' | 'done' | 'error';

function statusToSteps(
  recordStatus: RecordStatus,
  processingStep: string | null
): Record<string, StepStatus> {
  switch (recordStatus) {
    case 'processing': {
      const stepMap: Record<string, Record<string, StepStatus>> = {
        extracting: { process: 'done', extract: 'active', search: 'pending', rank: 'pending' },
        searching:  { process: 'done', extract: 'done',   search: 'active', rank: 'pending' },
        ranking:    { process: 'done', extract: 'done',   search: 'done',   rank: 'active' },
      };
      return stepMap[processingStep ?? ''] ?? { process: 'done', extract: 'active', search: 'pending', rank: 'pending' };
    }
    case 'matched':
    case 'needs_review':
    case 'added':
      return { process: 'done', extract: 'done', search: 'done', rank: 'done' };
    case 'failed':
      return { process: 'done', extract: 'done', search: 'error', rank: 'pending' };
    default:
      return { process: 'active', extract: 'pending', search: 'pending', rank: 'pending' };
  }
}

export default function ProcessingScreen({ recordId, onNavigate }: ProcessingScreenProps) {
  const [photos, setPhotos] = useState<RecordPhoto[]>([]);
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>(
    statusToSteps('processing', 'extracting')
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [finalStatus, setFinalStatus] = useState<'matched' | 'needs_review' | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigatedRef = useRef(false);
  const lastChangeRef = useRef<number>(Date.now());
  const lastStepRef = useRef<string | null>(null);
  const STUCK_TIMEOUT_MS = 90_000;

  useEffect(() => {
    supabase
      .from('record_photos')
      .select('*')
      .eq('record_id', recordId)
      .then(({ data }) => setPhotos(data ?? []));
  }, [recordId]);

  const checkStatus = useCallback(async () => {
    const { data: record } = await supabase
      .from('records')
      .select('status, error_message, processing_step')
      .eq('id', recordId)
      .maybeSingle();

    if (!record) return;

    const status = record.status as RecordStatus;
    const step = record.processing_step as string | null;

    setStepStatuses(statusToSteps(status, step));

    if (status === 'processing') {
      if (step !== lastStepRef.current) {
        lastStepRef.current = step;
        lastChangeRef.current = Date.now();
      } else if (Date.now() - lastChangeRef.current > STUCK_TIMEOUT_MS) {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
        setError('Processing timed out. The record appears to be stuck. Please try again.');
        setStepStatuses(prev => {
          const active = Object.entries(prev).find(([, v]) => v === 'active');
          if (!active) return { ...prev, extract: 'error' };
          return { ...prev, [active[0]]: 'error' };
        });
        await supabase
          .from('records')
          .update({ status: 'failed', error_message: 'Processing timed out (client-side)', processing_step: null })
          .eq('id', recordId);
        return;
      }
    }

    if (status === 'matched' || status === 'needs_review') {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        setFinalStatus(status === 'matched' ? 'matched' : 'needs_review');
        setDone(true);
        setTimeout(() => {
          if (status === 'matched') onNavigate('match-review', recordId);
          else onNavigate('needs-review', recordId);
        }, 1200);
      }
    } else if (status === 'failed') {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      setError(record.error_message ?? 'Processing failed.');
      setStepStatuses(prev => {
        const active = Object.entries(prev).find(([, v]) => v === 'active');
        if (!active) return { ...prev, search: 'error' };
        return { ...prev, [active[0]]: 'error' };
      });
    }
  }, [recordId, onNavigate]);

  useEffect(() => {
    checkStatus();
    intervalRef.current = setInterval(checkStatus, 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [checkStatus]);

  const coverPhoto = photos.find(p => p.photo_type === 'cover_front') ?? photos[0];

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)] lg:min-h-screen">
      <div className="border-b border-black px-4 py-3 lg:px-8 lg:py-4">
        <div className="flex items-baseline gap-2 lg:gap-4">
          <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black">Processing</h1>
          <span className="text-[10px] text-neutral-400 uppercase tracking-wider">Record Analysis</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center py-10 px-4 lg:py-16 lg:px-8">
        <div className="w-full max-w-lg">
          {photos.length > 0 && (
            <div className="flex gap-2 mb-8 justify-center lg:mb-10">
              {photos.slice(0, 4).map((photo) => (
                <div
                  key={photo.id}
                  className={`border border-neutral-200 overflow-hidden bg-neutral-50 transition-all ${
                    photo.id === coverPhoto?.id ? 'w-16 h-16 border-black sm:w-20 sm:h-20' : 'w-11 h-11 sm:w-14 sm:h-14'
                  }`}
                >
                  <img src={photo.file_url} alt={photo.photo_type} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}

          <div className="border border-black mb-6 lg:mb-8">
            <div className="px-3 py-2 border-b border-black bg-neutral-50 lg:px-4">
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Pipeline Status</p>
            </div>
            <div className="divide-y divide-neutral-100">
              {STEPS.map((step, idx) => {
                const status = stepStatuses[step.id] ?? 'pending';
                return (
                  <div key={step.id} className="flex items-center gap-3 px-3 py-3 lg:gap-4 lg:px-4">
                    <div className="w-5 shrink-0 flex items-center justify-center">
                      {status === 'done'    && <CheckCircle2 className="w-4 h-4 text-black" />}
                      {status === 'active'  && <Loader2 className="w-4 h-4 text-black animate-spin" />}
                      {status === 'error'   && <XCircle className="w-4 h-4 text-black" />}
                      {status === 'pending' && (
                        <span className="text-[9px] font-medium text-neutral-300 uppercase tracking-widest">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium transition-colors ${
                        status === 'pending' ? 'text-neutral-300' : 'text-black'
                      }`}>
                        {step.label}
                      </p>
                      {status === 'active' && (
                        <p className="text-[10px] text-neutral-400 mt-0.5">{step.sublabel}</p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {status === 'done'    && <span className="text-[9px] uppercase tracking-widest text-neutral-400">Done</span>}
                      {status === 'active'  && <span className="text-[9px] uppercase tracking-widest text-black animate-pulse">Running</span>}
                      {status === 'pending' && <span className="text-[9px] uppercase tracking-widest text-neutral-200">Waiting</span>}
                      {status === 'error'   && <span className="text-[9px] uppercase tracking-widest text-black">Failed</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {done && finalStatus && (
            <div className="border border-black px-3 py-3 flex items-center gap-3 bg-neutral-50 lg:px-4">
              {finalStatus === 'matched' ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-black shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-black">Matches Found</p>
                    <p className="text-[10px] text-neutral-500 mt-0.5">Redirecting to Match Review...</p>
                  </div>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-black shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-black">Needs Review</p>
                    <p className="text-[10px] text-neutral-500 mt-0.5">No confident matches found. Redirecting...</p>
                  </div>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="border border-black px-3 py-3 lg:px-4">
              <p className="text-[9px] uppercase tracking-widest font-medium text-black mb-1">Processing Error</p>
              <p className="text-[11px] text-neutral-600">{error}</p>
              <div className="flex flex-col mt-3 border border-black sm:flex-row">
                <button
                  onClick={() => onNavigate('dashboard')}
                  className="flex-1 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500 hover:bg-neutral-100 hover:text-black transition-colors border-b border-black sm:border-b-0 sm:border-r sm:py-2"
                >
                  Back to Queue
                </button>
                <button
                  onClick={() => onNavigate('upload')}
                  className="flex-1 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500 hover:bg-neutral-100 hover:text-black transition-colors border-b border-black sm:border-b-0 sm:border-r sm:py-2"
                >
                  Scan Next
                </button>
                <button
                  onClick={() => onNavigate('needs-review', recordId)}
                  className="flex-1 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-black hover:bg-neutral-100 transition-colors sm:py-2"
                >
                  Manual Review
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
