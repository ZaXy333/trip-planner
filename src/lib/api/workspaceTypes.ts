import type {
  DayViewSetting,
  MapStyle,
  Place,
  SavedFolder,
  TravelModeOption,
  TripSet,
} from '../../types/trip';

export interface WorkspaceSettings {
  theme: 'light' | 'dark';
  dayViewSetting: DayViewSetting;
  mapStyle: MapStyle;
  travelMode: TravelModeOption;
  activeSetId: string;
  activeDayNumber: number;
  recommendationRegion: string;
  recommendationCategories: string[];
}

export interface WorkspaceSnapshot {
  sets: TripSet[];
  savedPlaces: Place[];
  savedFolders: SavedFolder[];
  settings: WorkspaceSettings;
}
