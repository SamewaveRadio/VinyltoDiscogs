import { useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface BatchProgress {
  running: boolean;
  total: number;
  completed: number;
  failed: number;
  currentIndex: number;
  currentRecordId: string | null;
  currentTitle: string | null;
}

export function useBatchProcessor() {
  const [progress, setProgress] = useState<BatchProgress>({
    running: false,
    total: 0,
    completed: 0,
    failed: 0,
    currentIndex: 0,
    currentRecordId: null,
    currentTitle: null,
  });

  const stopRef = useRef(false);

  const processRecords = useCallback(async (
    recordIds: string[],
    recordTitles: Record<string, string>,
  ) => {
    if (recordIds.length === 0) return;

    stopRef.current = false;
    setProgress({
      running: true,
      total: recordIds.length,
      completed: 0,
      failed: 0,
      currentIndex: 0,
      currentRecordId: recordIds[0],
      currentTitle: recordTitles[recordIds[0]] ?? null,
    });

    let completed = 0;
    let failed = 0;

    for (let i = 0; i < recordIds.length; i++) {
      if (stopRef.current) break;

      const recordId = recordIds[i];

      setProgress(prev => ({
        ...prev,
        currentIndex: i,
        currentRecordId: recordId,
        currentTitle: recordTitles[recordId] ?? null,
      }));

      try {
        const { error: fnError } = await supabase.functions.invoke('process-record', {
          body: { record_id: recordId },
        });

        if (fnError) {
          failed++;
        } else {
          const pollResult = await pollUntilDone(recordId);
          if (pollResult === 'failed') failed++;
          else completed++;
        }
      } catch {
        failed++;
      }

      setProgress(prev => ({ ...prev, completed, failed }));
    }

    setProgress(prev => ({
      ...prev,
      running: false,
      completed,
      failed,
      currentRecordId: null,
      currentTitle: null,
    }));
  }, []);

  const stopBatch = useCallback(() => {
    stopRef.current = true;
  }, []);

  return { progress, processRecords, stopBatch };
}

async function pollUntilDone(recordId: string, maxAttempts = 120): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const { data } = await supabase
      .from('records')
      .select('status')
      .eq('id', recordId)
      .maybeSingle();

    if (!data) return 'failed';
    if (data.status === 'matched' || data.status === 'needs_review' || data.status === 'added') return data.status;
    if (data.status === 'failed') return 'failed';
  }
  return 'failed';
}
