import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { VinylRecord, RecordStatus } from '../types';

type Screen = 'dashboard' | 'upload' | 'processing' | 'match-review' | 'needs-review' | 'settings';

interface QueueDashboardProps {
  onNavigate: (screen: Screen, recordId?: string) => void;
}

const STATUS_META: Record<RecordStatus, { label: string; badgeClass: string; dotPulse?: boolean }> = {
  uploaded:     { label: 'Uploaded',     badgeClass: 'border-neutral-200 text-neutral-400' },
  queued:       { label: 'Queued',       badgeClass: 'border-neutral-300 text-neutral-500' },
  processing:   { label: 'Processing',   badgeClass: 'border-neutral-400 text-neutral-600', dotPulse: true },
  matched:      { label: 'Matched',      badgeClass: 'border-black text-black' },
  needs_review: { label: 'Needs Review', badgeClass: 'border-neutral-700 text-neutral-700' },
  added:        { label: 'Added',        badgeClass: 'border-neutral-300 text-neutral-400' },
  failed:       { label: 'Failed',       badgeClass: 'border-black bg-black text-white' },
};

const STATUS_ORDER: RecordStatus[] = ['processing', 'needs_review', 'matched', 'added', 'failed'];

interface RecordWithThumb extends VinylRecord {
  thumbUrl?: string;
}

export default function QueueDashboard({ onNavigate }: QueueDashboardProps) {
  const { user } = useAuth();
  const [records, setRecords] = useState<RecordWithThumb[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const buildThumbMap = async (recs: VinylRecord[]) => {
    if (recs.length === 0) return {};
    const { data: photos } = await supabase
      .from('record_photos')
      .select('record_id, photo_type, file_url')
      .in('record_id', recs.map(r => r.id));

    const thumbMap: Record<string, string> = {};
    if (photos) {
      for (const photo of photos) {
        if (!thumbMap[photo.record_id]) thumbMap[photo.record_id] = photo.file_url;
        if (photo.photo_type === 'cover_front') thumbMap[photo.record_id] = photo.file_url;
      }
    }
    return thumbMap;
  };

  const fetchRecords = useCallback(async () => {
    if (!user) return;
    const { data: recs } = await supabase
      .from('records')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    const recList = recs ?? [];
    if (recList.length === 0) {
      setRecords([]);
      setLoading(false);
      return;
    }

    const thumbMap = await buildThumbMap(recList);
    setRecords(recList.map(r => ({ ...r, thumbUrl: thumbMap[r.id] })));
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('queue-dashboard-records')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'records', filter: `user_id=eq.${user.id}` },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            setRecords(prev => prev.filter(r => r.id !== payload.old.id));
            return;
          }

          const updated = payload.new as VinylRecord;

          if (payload.eventType === 'INSERT') {
            const thumbMap = await buildThumbMap([updated]);
            setRecords(prev => [{ ...updated, thumbUrl: thumbMap[updated.id] }, ...prev]);
            return;
          }

          if (payload.eventType === 'UPDATE') {
            setRecords(prev => prev.map(r =>
              r.id === updated.id ? { ...r, ...updated } : r
            ));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const handleDelete = async (e: React.MouseEvent, recordId: string) => {
    e.stopPropagation();
    setDeletingId(recordId);
    await supabase.from('records').delete().eq('id', recordId);
    setRecords(prev => prev.filter(r => r.id !== recordId));
    setDeletingId(null);
  };

  const handleRowClick = (record: RecordWithThumb) => {
    if (record.status === 'matched') onNavigate('match-review', record.id);
    else if (record.status === 'needs_review') onNavigate('needs-review', record.id);
    else if (record.status === 'processing') onNavigate('processing', record.id);
  };

  const sortedRecords = useMemo(() => {
    const grouped: Record<RecordStatus, RecordWithThumb[]> = {} as any;
    STATUS_ORDER.forEach(s => { grouped[s] = []; });
    records.forEach(r => { if (grouped[r.status]) grouped[r.status].push(r); });
    return grouped;
  }, [records]);

  const processingCount = records.filter(r => r.status === 'processing').length;
  const totalCount = records.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-black px-4 py-3 flex items-center justify-between lg:px-8 lg:py-4">
        <div className="flex items-baseline gap-2 lg:gap-4 min-w-0">
          <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black shrink-0">Records</h1>
          <span className="text-[10px] text-neutral-400 uppercase tracking-wider shrink-0">{totalCount}</span>
          {processingCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-neutral-500 uppercase tracking-wider shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse" />
              {processingCount} active
            </span>
          )}
        </div>
        <button
          onClick={() => onNavigate('upload')}
          className="flex items-center gap-1.5 px-3 py-2 bg-black text-white text-[10px] font-semibold uppercase tracking-widest hover:bg-neutral-800 transition-colors shrink-0 lg:py-1.5"
        >
          <Plus className="w-3 h-3" />
          <span className="hidden sm:inline">New Record</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      {totalCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 lg:py-32 px-4">
          <p className="text-[10px] uppercase tracking-widest text-neutral-400 mb-4">No records in archive</p>
          <button
            onClick={() => onNavigate('upload')}
            className="flex items-center gap-2 px-4 py-2.5 border border-black text-[10px] font-semibold uppercase tracking-widest text-black hover:bg-black hover:text-white transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add First Record
          </button>
        </div>
      ) : (
        <div>
          <div className="hidden lg:grid grid-cols-[40px_1fr_130px_100px_80px_90px_36px] px-8 py-2 border-b border-neutral-200 bg-neutral-50">
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400" />
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Artist / Title</p>
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Label</p>
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Cat No.</p>
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Year</p>
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Status</p>
            <p />
          </div>

          {STATUS_ORDER.map((status) => {
            const statusRecords = sortedRecords[status];
            if (!statusRecords || statusRecords.length === 0) return null;
            return statusRecords.map((record) => (
              <RecordRow
                key={record.id}
                record={record}
                onRowClick={() => handleRowClick(record)}
                onDelete={handleDelete}
                isDeleting={deletingId === record.id}
              />
            ));
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RecordStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 border text-[9px] font-medium uppercase tracking-widest whitespace-nowrap ${meta.badgeClass}`}>
      <span className={`w-1 h-1 rounded-full shrink-0 ${
        status === 'failed'       ? 'bg-white' :
        status === 'added'        ? 'bg-neutral-300' :
        status === 'matched'      ? 'bg-black' :
        status === 'needs_review' ? 'bg-neutral-700' :
        'bg-neutral-400'
      } ${meta.dotPulse ? 'animate-pulse' : ''}`} />
      {meta.label}
    </span>
  );
}

interface RecordRowProps {
  record: RecordWithThumb;
  onRowClick: () => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  isDeleting: boolean;
}

function RecordRow({ record, onRowClick, onDelete, isDeleting }: RecordRowProps) {
  const isClickable = ['matched', 'needs_review', 'processing'].includes(record.status);

  return (
    <>
      <div
        onClick={isClickable ? onRowClick : undefined}
        className={`flex items-center gap-3 px-4 py-3 border-b border-neutral-100 lg:hidden ${
          isClickable ? 'cursor-pointer active:bg-neutral-50' : ''
        }`}
      >
        <div className="w-10 h-10 border border-neutral-200 overflow-hidden bg-neutral-50 shrink-0">
          {record.thumbUrl ? (
            <img src={record.thumbUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-neutral-100" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-medium text-black truncate">{record.artist ?? '---'}</span>
            {record.title && (
              <>
                <span className="text-neutral-300 text-xs shrink-0">/</span>
                <span className="text-xs text-neutral-600 truncate">{record.title}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={record.status} />
            {record.label && (
              <span className="text-[10px] text-neutral-400 truncate">{record.label}</span>
            )}
          </div>
          {record.status === 'failed' && record.error_message && (
            <p className="text-[10px] text-neutral-400 mt-0.5 truncate">{record.error_message}</p>
          )}
        </div>
        <button
          onClick={(e) => onDelete(e, record.id)}
          disabled={isDeleting}
          className="p-2 text-neutral-300 hover:text-black transition-colors shrink-0"
        >
          {isDeleting ? <RotateCcw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div
        onClick={isClickable ? onRowClick : undefined}
        className={`hidden lg:grid grid-cols-[40px_1fr_130px_100px_80px_90px_36px] items-center px-8 py-2.5 border-b border-neutral-100 group transition-colors ${
          isClickable ? 'cursor-pointer hover:bg-neutral-50' : ''
        }`}
      >
        <div className="w-7 h-7 border border-neutral-200 overflow-hidden bg-neutral-50 shrink-0">
          {record.thumbUrl ? (
            <img src={record.thumbUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-neutral-100" />
          )}
        </div>
        <div className="min-w-0 pr-4">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-xs font-medium text-black truncate">{record.artist ?? '---'}</span>
            {record.title && (
              <>
                <span className="text-neutral-300 text-xs shrink-0">/</span>
                <span className="text-xs text-neutral-600 truncate">{record.title}</span>
              </>
            )}
          </div>
          {record.status === 'failed' && record.error_message && (
            <p className="text-[10px] text-neutral-400 mt-0.5 truncate">{record.error_message}</p>
          )}
        </div>
        <div className="text-[11px] text-neutral-500 truncate pr-2">{record.label ?? '---'}</div>
        <div className="text-[11px] text-neutral-500 font-mono truncate pr-2">{record.catalog_number ?? '---'}</div>
        <div className="text-[11px] text-neutral-500">{record.year ?? '---'}</div>
        <div><StatusBadge status={record.status} /></div>
        <div className="flex justify-end">
          <button
            onClick={(e) => onDelete(e, record.id)}
            disabled={isDeleting}
            className="p-1 text-neutral-200 hover:text-black transition-colors opacity-0 group-hover:opacity-100"
          >
            {isDeleting ? <RotateCcw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          </button>
        </div>
      </div>
    </>
  );
}
