import { useState, useRef, useCallback } from 'react';
import { X, Loader2, CheckCircle2, ArrowLeft, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { PhotoType } from '../types';

type Screen = 'dashboard' | 'upload' | 'processing' | 'match-review' | 'needs-review' | 'settings';

interface NewRecordUploadProps {
  onNavigate: (screen: Screen, recordId?: string) => void;
}

interface PhotoSlot {
  type: PhotoType;
  label: string;
  shortLabel: string;
}

const photoSlots: PhotoSlot[] = [
  { type: 'cover_front', label: 'Cover Front', shortLabel: 'A' },
  { type: 'cover_back', label: 'Cover Back', shortLabel: 'B' },
  { type: 'label_a', label: 'Label --- Side A', shortLabel: 'C' },
  { type: 'label_b', label: 'Label --- Side B', shortLabel: 'D' },
];

interface UploadedFile {
  file: File;
  preview: string;
  uploading: boolean;
  uploaded: boolean;
  url?: string;
}

export default function NewRecordUpload({ onNavigate }: NewRecordUploadProps) {
  const { user } = useAuth();
  const [uploads, setUploads] = useState<Partial<Record<PhotoType, UploadedFile>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState<PhotoType | null>(null);
  const fileInputRefs = useRef<Partial<Record<PhotoType, HTMLInputElement>>>({});

  const handleFile = useCallback(async (type: PhotoType, file: File) => {
    if (!file.type.startsWith('image/')) return;

    const preview = URL.createObjectURL(file);
    setUploads(prev => ({ ...prev, [type]: { file, preview, uploading: true, uploaded: false } }));

    if (!user) return;

    const ext = file.name.split('.').pop();
    const path = `${user.id}/${Date.now()}_${type}.${ext}`;
    const { data, error } = await supabase.storage
      .from('record-photos')
      .upload(path, file, { upsert: true });

    if (error) {
      setUploads(prev => { const u = { ...prev }; delete u[type]; return u; });
      setError(`Upload failed: ${error.message}`);
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from('record-photos').getPublicUrl(data.path);
    setUploads(prev => ({ ...prev, [type]: { file, preview, uploading: false, uploaded: true, url: publicUrl } }));
  }, [user]);

  const handleDrop = (e: React.DragEvent, type: PhotoType) => {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(type, file);
  };

  const removePhoto = (type: PhotoType) => {
    const upload = uploads[type];
    if (upload?.preview) URL.revokeObjectURL(upload.preview);
    setUploads(prev => { const u = { ...prev }; delete u[type]; return u; });
    if (fileInputRefs.current[type]) fileInputRefs.current[type]!.value = '';
  };

  const createRecordAndPhotos = async () => {
    if (!user) throw new Error('Not authenticated');

    const uploadedPhotos = Object.entries(uploads).filter(
      ([, v]) => v?.uploaded && v.url
    ) as [PhotoType, UploadedFile & { url: string }][];

    if (uploadedPhotos.length === 0) throw new Error('Add at least one photo.');
    if (Object.values(uploads).some(u => u?.uploading)) throw new Error('Wait for uploads to complete.');

    const { data: record, error: recordError } = await supabase
      .from('records')
      .insert({ user_id: user.id, status: 'uploaded' })
      .select()
      .single();

    if (recordError || !record) throw new Error(recordError?.message ?? 'Failed to create record.');

    const { error: photosError } = await supabase
      .from('record_photos')
      .insert(uploadedPhotos.map(([type, upload]) => ({
        record_id: record.id,
        photo_type: type,
        file_url: upload.url,
      })));

    if (photosError) throw new Error(photosError.message ?? 'Failed to save photos.');

    return record;
  };

  const handleProcessNow = async () => {
    setSubmitting(true);
    setError('');

    try {
      const record = await createRecordAndPhotos();

      const { data: session } = await supabase.auth.getSession();
      const accessToken = session?.session?.access_token;
      if (!accessToken) throw new Error('You must be logged in to process records.');

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enqueue-record`;
      const enqueueRes = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ record_id: record.id }),
      });

      if (!enqueueRes.ok) {
        const body = await enqueueRes.json().catch(() => ({}));
        throw new Error(body.error || `Processing failed (${enqueueRes.status})`);
      }

      setSubmitting(false);
      onNavigate('processing', record.id);
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const uploadedCount = Object.values(uploads).filter(u => u?.uploaded).length;
  const uploadingCount = Object.values(uploads).filter(u => u?.uploading).length;
  const canSubmit = !submitting && uploadedCount > 0 && uploadingCount === 0;

  return (
    <div>
      <div className="border-b border-black px-4 py-3 flex items-center gap-3 lg:px-8 lg:py-4 lg:gap-4">
        <button
          onClick={() => onNavigate('dashboard')}
          className="text-neutral-400 hover:text-black transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-baseline gap-2 lg:gap-4">
          <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-black">New Record</h1>
          <span className="text-[10px] text-neutral-400 uppercase tracking-wider hidden sm:inline">Scan Station</span>
        </div>
      </div>

      <div className="px-4 py-6 lg:px-8 lg:py-8">
        {error && (
          <div className="mb-4 border border-black px-3 py-2.5 lg:mb-6 lg:px-4">
            <p className="text-xs text-black">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-0 border border-black mb-6 lg:mb-8 lg:max-w-2xl">
          {photoSlots.map(({ type, label, shortLabel }, slotIndex) => {
            const upload = uploads[type];
            const isDragging = dragOver === type;
            const isTopRow = slotIndex < 2;
            const isLeftCol = slotIndex % 2 === 0;

            return (
              <div
                key={type}
                className={[
                  isTopRow ? 'border-b border-black' : '',
                  isLeftCol ? 'border-r border-black' : '',
                ].join(' ')}
              >
                <div className="px-2 py-1.5 border-b border-black flex items-center justify-between bg-neutral-50 lg:px-3 lg:py-2">
                  <div className="flex items-center gap-1.5 lg:gap-2">
                    <span className="text-[9px] font-semibold text-neutral-400 w-3">{shortLabel}</span>
                    <span className="text-[9px] font-medium uppercase tracking-wider text-black lg:text-[10px]">{label}</span>
                  </div>
                  {upload?.uploaded && <CheckCircle2 className="w-3 h-3 text-black" />}
                  {upload?.uploading && <Loader2 className="w-3 h-3 text-neutral-400 animate-spin" />}
                </div>

                {upload ? (
                  <div className="relative aspect-square bg-neutral-100 group">
                    <img src={upload.preview} alt={label} className="w-full h-full object-cover" />
                    {upload.uploading && (
                      <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-black animate-spin" />
                      </div>
                    )}
                    {!upload.uploading && (
                      <button
                        onClick={() => removePhoto(type)}
                        className="absolute top-1.5 right-1.5 w-6 h-6 bg-black flex items-center justify-center lg:w-5 lg:h-5 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(type); }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => handleDrop(e, type)}
                    onClick={() => fileInputRefs.current[type]?.click()}
                    className={`aspect-square flex flex-col items-center justify-center cursor-pointer transition-colors ${
                      isDragging ? 'bg-neutral-100' : 'bg-white hover:bg-neutral-50'
                    }`}
                  >
                    <div className="w-8 h-8 border border-dashed border-neutral-300 flex items-center justify-center mb-2">
                      <Plus className="w-3.5 h-3.5 text-neutral-300" />
                    </div>
                    <p className="text-[9px] uppercase tracking-widest text-neutral-400">
                      <span className="hidden sm:inline">Drop or click</span>
                      <span className="sm:hidden">Tap to add</span>
                    </p>
                  </div>
                )}

                <input
                  ref={(el) => { if (el) fileInputRefs.current[type] = el; }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(type, f); }}
                />
              </div>
            );
          })}
        </div>

        <div className="text-[10px] uppercase tracking-widest text-neutral-400 mb-4 lg:mb-0 lg:max-w-2xl">
          {uploadingCount > 0 ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Uploading {uploadingCount} file{uploadingCount !== 1 ? 's' : ''}
            </span>
          ) : uploadedCount > 0 ? (
            `${uploadedCount} of 4 slots filled`
          ) : (
            'No photos added'
          )}
        </div>

        <div className="flex flex-col gap-0 border border-black lg:flex-row lg:w-fit lg:mt-4 lg:max-w-2xl">
          <button
            onClick={() => onNavigate('dashboard')}
            className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-neutral-500 hover:bg-neutral-100 hover:text-black transition-colors border-b border-black lg:border-b-0 lg:border-r lg:py-2"
          >
            Cancel
          </button>
          <button
            onClick={handleProcessNow}
            disabled={!canSubmit}
            className="flex items-center justify-center gap-2 px-5 py-3 bg-black text-white text-[10px] font-semibold uppercase tracking-widest hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors lg:py-2"
          >
            {submitting ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Processing</>
            ) : (
              'Process Now'
            )}
          </button>
        </div>

        <div className="mt-8 border-t border-neutral-200 pt-5 lg:mt-10 lg:pt-6 lg:max-w-2xl">
          <p className="text-[9px] uppercase tracking-widest font-medium text-neutral-400 mb-3">Scan Guidelines</p>
          <div className="grid grid-cols-2 gap-0 border border-neutral-200 lg:grid-cols-4">
            {[
              { slot: 'A', tip: 'Front cover with artist and title clearly visible.' },
              { slot: 'B', tip: 'Back cover showing track listing and barcode.' },
              { slot: 'C', tip: 'Side A label showing catalog number and year.' },
              { slot: 'D', tip: 'Side B label for additional catalog verification.' },
            ].map(({ slot, tip }, i) => (
              <div key={slot} className={`px-3 py-3 ${
                i < 2 ? 'border-b border-neutral-200 lg:border-b-0' : ''
              } ${i % 2 === 0 ? 'border-r border-neutral-200' : ''} ${
                i < 3 ? 'lg:border-r lg:border-neutral-200' : 'lg:border-r-0'
              }`}>
                <span className="text-[9px] font-semibold uppercase tracking-widest text-neutral-300 block mb-1">{slot}</span>
                <p className="text-[10px] text-neutral-500 leading-relaxed">{tip}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
