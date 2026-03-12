import { useEffect, useState, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { RecordPhoto } from '../types';

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
  { id: 'upload',   label: 'Uploading images',    sublabel: 'Preparing photo data' },
  { id: 'extract',  label: 'Extracting metadata', sublabel: 'Reading artist, label, catalog number' },
  { id: 'search',   label: 'Searching Discogs',   sublabel: 'Querying release database' },
  { id: 'rank',     label: 'Ranking matches',      sublabel: 'Scoring candidates by relevance' },
];

type StepStatus = 'pending' | 'active' | 'done' | 'error';

export default function ProcessingScreen({ recordId, onNavigate }: ProcessingScreenProps) {
  const [photos, setPhotos] = useState<RecordPhoto[]>([]);
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>({
    upload: 'done',
    extract: 'active',
    search: 'pending',
    rank: 'pending',
  });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [finalStatus, setFinalStatus] = useState<'matched' | 'needs_review' | null>(null);
  const calledRef = useRef(false);

  useEffect(() => {
    supabase
      .from('record_photos')
      .select('*')
      .eq('record_id', recordId)
      .then(({ data }) => setPhotos(data ?? []));
  }, [recordId]);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    const run = async () => {
      const stepDelay = (ms: number) => new Promise(res => setTimeout(res, ms));

      setStepStatuses({ upload: 'done', extract: 'active', search: 'pending', rank: 'pending' });
      await stepDelay(800);

      setStepStatuses({ upload: 'done', extract: 'done', search: 'active', rank: 'pending' });

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

        const response = await fetch(`${supabaseUrl}/functions/v1/process-record`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ record_id: recordId }),
        });

        setStepStatuses({ upload: 'done', extract: 'done', search: 'done', rank: 'active' });
        await stepDelay(600);

        if (!response.ok) {
          const errData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errData.error ?? `HTTP ${response.status}`);
        }

        const result = await response.json();

        setStepStatuses({ upload: 'done', extract: 'done', search: 'done', rank: 'done' });
        await stepDelay(500);

        setFinalStatus(result.status === 'matched' ? 'matched' : 'needs_review');
        setDone(true);

        await stepDelay(1200);

        if (result.status === 'matched') {
          onNavigate('match-review', recordId);
        } else {
          onNavigate('needs-review', recordId);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStepStatuses(prev => {
          const active = Object.entries(prev).find(([, v]) => v === 'active');
          if (!active) return prev;
          return { ...prev, [active[0]]: 'error' };
        });

        await supabase.from('records').update({
          status: 'failed',
          error_message: msg,
        }).eq('id', recordId);
      }
    };

    run();
  }, [recordId, onNavigate]);

  const coverPhoto = photos.find(p => p.photo_type === 'cover_front') ?? photos[0];

  return (
    <div className="min-h-screen flex flex-col">
      <div className="border-b border-black px-8 py-4">
        <div className="flex items-baseline gap-4">
          <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black">Processing</h1>
          <span className="text-[10px] text-neutral-400 uppercase tracking-wider">Record Analysis</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center py-16 px-8">
        <div className="w-full max-w-lg">
          {photos.length > 0 && (
            <div className="flex gap-2 mb-10 justify-center">
              {photos.slice(0, 4).map((photo) => (
                <div
                  key={photo.id}
                  className={`border border-neutral-200 overflow-hidden bg-neutral-50 transition-all ${
                    photo.id === coverPhoto?.id ? 'w-20 h-20 border-black' : 'w-14 h-14'
                  }`}
                >
                  <img src={photo.file_url} alt={photo.photo_type} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}

          <div className="border border-black mb-8">
            <div className="px-4 py-2 border-b border-black bg-neutral-50">
              <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Pipeline Status</p>
            </div>
            <div className="divide-y divide-neutral-100">
              {STEPS.map((step, idx) => {
                const status = stepStatuses[step.id] ?? 'pending';
                return (
                  <div key={step.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="w-5 shrink-0 flex items-center justify-center">
                      {status === 'done' && <CheckCircle2 className="w-4 h-4 text-black" />}
                      {status === 'active' && <Loader2 className="w-4 h-4 text-black animate-spin" />}
                      {status === 'error' && <XCircle className="w-4 h-4 text-black" />}
                      {status === 'pending' && (
                        <span className="text-[9px] font-medium text-neutral-300 uppercase tracking-widest">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium transition-colors ${
                        status === 'pending' ? 'text-neutral-300' :
                        status === 'active' ? 'text-black' :
                        status === 'done' ? 'text-black' : 'text-black'
                      }`}>
                        {step.label}
                      </p>
                      {status === 'active' && (
                        <p className="text-[10px] text-neutral-400 mt-0.5">{step.sublabel}</p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {status === 'done' && (
                        <span className="text-[9px] uppercase tracking-widest text-neutral-400">Done</span>
                      )}
                      {status === 'active' && (
                        <span className="text-[9px] uppercase tracking-widest text-black animate-pulse">Running</span>
                      )}
                      {status === 'pending' && (
                        <span className="text-[9px] uppercase tracking-widest text-neutral-200">Waiting</span>
                      )}
                      {status === 'error' && (
                        <span className="text-[9px] uppercase tracking-widest text-black">Failed</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {done && finalStatus && (
            <div className="border border-black px-4 py-3 flex items-center gap-3 bg-neutral-50">
              {finalStatus === 'matched' ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-black shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-black">Matches Found</p>
                    <p className="text-[10px] text-neutral-500 mt-0.5">Redirecting to Match Review…</p>
                  </div>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-black shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-black">Needs Review</p>
                    <p className="text-[10px] text-neutral-500 mt-0.5">No confident matches found. Redirecting…</p>
                  </div>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="border border-black px-4 py-3">
              <p className="text-[9px] uppercase tracking-widest font-medium text-black mb-1">Processing Error</p>
              <p className="text-[11px] text-neutral-600">{error}</p>
              <div className="flex gap-0 mt-3 border border-black">
                <button
                  onClick={() => onNavigate('dashboard')}
                  className="flex-1 py-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-500 hover:bg-neutral-100 hover:text-black transition-colors border-r border-black"
                >
                  Back to Queue
                </button>
                <button
                  onClick={() => onNavigate('needs-review', recordId)}
                  className="flex-1 py-2 text-[10px] font-semibold uppercase tracking-widest text-black hover:bg-neutral-100 transition-colors"
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
