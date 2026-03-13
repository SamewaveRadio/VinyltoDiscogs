export type RecordStatus = 'queued' | 'uploaded' | 'processing' | 'matched' | 'needs_review' | 'added' | 'failed';
export type PhotoType = 'cover_front' | 'cover_back' | 'label_a' | 'label_b';

export interface UserProfile {
  id: string;
  email: string;
  discogs_username: string | null;
  discogs_token_encrypted: string | null;
  created_at: string;
}

export interface VinylRecord {
  id: string;
  user_id: string;
  status: RecordStatus;
  artist: string | null;
  title: string | null;
  label: string | null;
  catalog_number: string | null;
  year: number | null;
  confidence: number | null;
  selected_release_id: string | null;
  selected_release_title: string | null;
  selected_release_score: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  photos?: RecordPhoto[];
  candidates?: DiscogsCandidate[];
}

export interface RecordPhoto {
  id: string;
  record_id: string;
  photo_type: PhotoType;
  file_url: string;
  created_at: string;
}

export interface DiscogsCandidate {
  id: string;
  record_id: string;
  discogs_release_id: string;
  title: string | null;
  label: string | null;
  catno: string | null;
  year: number | null;
  country: string | null;
  format: string | null;
  score: number;
  reasons_json: string[];
  thumb_url: string | null;
  visual_score: number | null;
  visual_reason: string | null;
  is_selected: boolean;
  created_at: string;
}
