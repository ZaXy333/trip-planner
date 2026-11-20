export type MapStyle = 'standard' | 'satellite';

export type DayViewSetting = 'tabs' | 'timeline';

export interface SavedFolder {
  id: string;
  name: string;
  createdAt: number;
}

export interface Place {
  id: string;
  name: string;
  category: string;
  tier: 1 | 2;
  lat: number;
  lng: number;
  description: string;
  address?: string;
  tags: string[];
  rating?: number;
  userRatingsTotal?: number;
  photoUrl?: string;
  folderIds?: string[];
}

export type TimelineEntry =
  | { type: 'place'; id: string; place: Place }
  | { type: 'day_break'; id: string };

export type TravelModeOption = 'WALKING' | 'DRIVING';

export interface RouteLegInfo {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  distanceText: string;
  durationText: string;
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteInfo {
  totalDistanceText: string;
  totalDurationText: string;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  legs: RouteLegInfo[];
  pathCoords: { lat: number; lng: number }[];
  mode: TravelModeOption;
  isFallbackEstimate?: boolean;
}

export interface DerivedDay {
  dayNumber: number; // 1, 2, 3...
  label: string; // "Dzień 1", "Dzień 2"...
  breakEntryId?: string; // ID elementu <br> rozpoczynającego ten dzień (dla dni >= 2)
  places: Place[];
  routeInfo?: RouteInfo | null;
}

export interface TripDay {
  id: string;
  label: string;
  places: Place[];
  routeInfo?: RouteInfo | null;
}

export interface TripSet {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  timeline: TimelineEntry[];
  routesByDay?: Record<number, RouteInfo>;
  // Pole zachowane dla kompatybilności wstecznej przy migracji z localStorage
  days?: TripDay[];
}
