import { useEffect, useState } from 'react';
import { Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { VinylRecord, RecordStatus } from '../types';

type Screen = 'dashboard' | 'upload' | 'processing' | 'match-review' | 'needs-review' | 'settings';

interface QueueDashboardProps {
  onNavigate: (screen: Screen, recordId?: string) => void;
}

const STATUS_META: Record<RecordStatus, { label: string; badgeClass: string; dotPulse?: boolean }> = {
  uploaded:     { label: 'Uploaded',     badgeClass: 'border-neutral-300 text-neutral-400' },
  processing:   { label: 'Processing',   badgeClass: 'border-neutral-400 text-neutral-600', dotPulse: true },
  matched:      { label: 'Matched',      badgeClass: 'border-black text-black' },
  needs_review: { label: 'Needs Review', badgeClass: 'border-neutral-700 text-neutral-700' },
  added:        { label: 'Added',        badgeClass: 'border-neutral-300 text-neutral-400' },
  failed:       { label: 'Failed',       badgeClass: 'border-black bg-black text-white' },
};

const STATUS_ORDER: RecordStatus[] = ['processing', 'uploaded', 'needs_review', 'matched', 'added', 'failed'];

interface RecordWithThumb extends VinylRecord {
  thumbUrl?: string;
}

export default function QueueDashboard({ onNavigate }: QueueDashboardProps) {
  const { user } = useAuth();
  const [records, setRecords] = useState<RecordWithThumb[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchRecords = async () => {
    if (!user) return;

    const { data: recs } = await supabase
      .from('records')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!recs || recs.length === 0) {
      setRecords([]);
      setLoading(false);
      return;
    }

    const { data: photos } = await supabase
      .from('record_photos')
      .select('record_id, photo_type, file_url')
      .in('record_id', recs.map(r => r.id));

    const thumbMap: Record<string, string> = {};
    if (photos) {
      for (const photo of photos) {
        if (!thumbMap[photo.record_id]) {
          thumbMap[photo.record_id] = photo.file_url;
        }
        if (photo.photo_type === 'cover_front') {
          thumbMap[photo.record_id] = photo.file_url;
        }
      }
    }

    setRecords(recs.map(r => ({ ...r, thumbUrl: thumbMap[r.id] })));
    setLoading(false);
  };

  useEffect(() => { fetchRecords(); }, [user]);

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
    else if (record.status === 'processing' || record.status === 'uploaded') onNavigate('processing', record.id);
  };

  const grouped = STATUS_ORDER.reduce((acc, status) => {
    acc[status] = records.filter(r => r.status === status);
    return acc;
  }, {} as Record<RecordStatus, RecordWithThumb[]>);

  const totalCount = records.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="border-b border-black px-8 py-4 flex items-center justify-between">
        <div className="flex items-baseline gap-4">
          <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black">Queue</h1>
          <span className="text-[10px] text-neutral-400 uppercase tracking-wider">{totalCount} records</span>
        </div>
        <button
          onClick={() => onNavigate('upload')}
          className="flex items-center gap-2 px-3 py-1.5 bg-black text-white text-[10px] font-semibold uppercase tracking-widest hover:bg-neutral-800 transition-colors"
        >
          <Plus className="w-3 h-3" />
          New Record
        </button>
      </div>

      {totalCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-32">
          <p className="text-[10px] uppercase tracking-widest text-neutral-400 mb-4">No records in archive</p>
          <button
            onClick={() => onNavigate('upload')}
            className="flex items-center gap-2 px-4 py-2 border border-black text-[10px] font-semibold uppercase tracking-widest text-black hover:bg-black hover:text-white transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add First Record
          </button>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-[40px_1fr_130px_100px_80px_90px_36px] px-8 py-2 border-b border-neutral-200 bg-neutral-50">
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400"></p>
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Artist / Title</p>
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Label</p>
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Cat No.</p>
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Year</p>
            <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400">Status</p>
            <p />
          </div>

          {STATUS_ORDER.map((status) => {
            const statusRecords = grouped[status];
            if (statusRecords.length === 0) return null;
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
        status === 'failed' ? 'bg-white' :
        status === 'added' ? 'bg-neutral-300' :
        status === 'matched' ? 'bg-black' :
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
  const isClickable = ['matched', 'needs_review', 'processing', 'uploaded'].includes(record.status);

  return (
    <div
      onClick={isClickable ? onRowClick : undefined}
      className={`grid grid-cols-[40px_1fr_130px_100px_80px_90px_36px] items-center px-8 py-2.5 border-b border-neutral-100 group transition-colors ${
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
          <span className="text-xs font-medium text-black truncate">{record.artist ?? '—'}</span>
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
      <div className="text-[11px] text-neutral-500 truncate pr-2">{record.label ?? '—'}</div>
      <div className="text-[11px] text-neutral-500 font-mono truncate pr-2">{record.catalog_number ?? '—'}</div>
      <div className="text-[11px] text-neutral-500">{record.year ?? '—'}</div>
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
  );
}
