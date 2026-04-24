export interface User {
  id: string;
  email: string;
  name?: string;
  organisation_id: string;
}
export interface PatrolRoute {
  id: string;
  organisation_id: string;
  name: string;
  code: string;
  description: string;
  area_type: string;
  focus: string;
  start_point: string;
  hotspots: string[];
  created_at: string;
}
export interface PatrolSession {
  id: string;
  route_id: string;
  patroller_id: string;
  patroller_name: string;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  is_complete: boolean;
}
export interface PatrolBusiness {
  id: string;
  session_id: string;
  organisation_id: string;
  route_id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  notes: string;
}
export interface SignInspection {
  id: string;
  business_id: string;
  session_id: string;
  organisation_id: string;
  patroller_id: string;
  patroller_name: string;
  patrol_type: 'day' | 'night';
  sign_category: string;
  sign_type: string;
  condition: { issues: string[]; severity: string };
  notes: string | null;
  status: 'submitted' | 'pending' | 'synced';
  date_logged: string;
}
export interface InspectionPhoto {
  id: string;
  inspection_id: string;
  business_id: string;
  patroller_id: string;
  photo_url: string;
  photo_category: 'sign' | 'surrounding';
  date_taken: string;
}
export interface SessionState {
  sessionId: string;
  routeId: string;
  patrollerId: string;
  patrollerName: string;
  elapsedSeconds: number;
  currentBusiness: {
    id: string;
    name: string | null;
    address: string | null;
    latitude: number;
    longitude: number;
    notes: string | null;
  } | null;
  currentPhotos: {
    sign: string[];
    surrounding: string[];
  };
  signPhotoUrls: string[];
  surroundingPhotoUrls: string[];
  currentPatrolType: 'day' | 'night' | null;
  currentSignCategory: string | null;
  currentSignType: string | null;
  currentIssues: string[];
  currentNotes: string | null;
  currentInspectionId: string | null;
}
