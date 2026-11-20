import { normalizeTripSet } from '../../utils/routeUtils';
import type {
  DayViewSetting,
  MapStyle,
  Place,
  SavedFolder,
  TravelModeOption,
  TripSet,
} from '../../types/trip';
import type { WorkspaceSnapshot } from './workspaceTypes';

const LOCAL_KEYS = {
  sets: ['trip_planner_sets_v2', 'trip_planner_sets_v1'],
  savedPlaces: 'trip_planner_saved_places_v1',
  savedFolders: 'trip_planner_saved_folders_v1',
  settings: 'trip_planner_settings_v1',
};

const readJson = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const createEmptyWorkspace = (): WorkspaceSnapshot => ({
  sets: [],
  savedPlaces: [],
  savedFolders: [],
  settings: {
    theme: 'light',
    dayViewSetting: 'tabs',
    mapStyle: 'standard',
    travelMode: 'WALKING',
    activeSetId: '',
    activeDayNumber: 1,
    recommendationRegion: '',
    recommendationCategories: ['monuments', 'restaurants', 'cafes'],
  },
});

export const readLegacyWorkspace = (): WorkspaceSnapshot | null => {
  const rawSets = LOCAL_KEYS.sets
    .map((key) => localStorage.getItem(key))
    .find((value): value is string => Boolean(value));
  const rawSavedPlaces = localStorage.getItem(LOCAL_KEYS.savedPlaces);
  const rawSavedFolders = localStorage.getItem(LOCAL_KEYS.savedFolders);
  const rawSettings = localStorage.getItem(LOCAL_KEYS.settings);

  if (!rawSets && !rawSavedPlaces && !rawSavedFolders && !rawSettings) return null;

  const workspace = createEmptyWorkspace();
  const parsedSets = rawSets ? readJson<TripSet[]>(LOCAL_KEYS.sets.find((key) => localStorage.getItem(key) === rawSets) || LOCAL_KEYS.sets[0]) : null;
  const parsedSavedPlaces = readJson<Array<Place & { folderId?: string }>>(LOCAL_KEYS.savedPlaces);
  const parsedSavedFolders = readJson<SavedFolder[]>(LOCAL_KEYS.savedFolders);
  const parsedSettings = readJson<{
    theme?: 'light' | 'dark';
    dayViewSetting?: DayViewSetting;
    mapStyle?: MapStyle;
    travelMode?: TravelModeOption;
    activeSetId?: string;
    activeDayNumber?: number;
    recommendationRegion?: string;
    recommendationCategories?: string[];
  }>(LOCAL_KEYS.settings);

  workspace.sets = Array.isArray(parsedSets)
    ? parsedSets.map((set) => normalizeTripSet(set))
    : [];
  workspace.savedPlaces = Array.isArray(parsedSavedPlaces)
    ? parsedSavedPlaces.map((place) => ({
        ...place,
        folderIds: Array.isArray(place.folderIds)
          ? place.folderIds
          : place.folderId
            ? [place.folderId]
            : [],
      }))
    : [];
  workspace.savedFolders = Array.isArray(parsedSavedFolders) ? parsedSavedFolders : [];

  if (parsedSettings) {
    workspace.settings = {
      ...workspace.settings,
      theme: parsedSettings.theme === 'dark' ? 'dark' : 'light',
      dayViewSetting: parsedSettings.dayViewSetting === 'timeline' ? 'timeline' : 'tabs',
      mapStyle: parsedSettings.mapStyle === 'satellite' ? 'satellite' : 'standard',
      travelMode: parsedSettings.travelMode === 'DRIVING' ? 'DRIVING' : 'WALKING',
      activeSetId: parsedSettings.activeSetId || '',
      activeDayNumber: parsedSettings.activeDayNumber || 1,
      recommendationRegion: parsedSettings.recommendationRegion || '',
      recommendationCategories: parsedSettings.recommendationCategories || workspace.settings.recommendationCategories,
    };
  }

  return workspace;
};

export const getLegacyDataCounts = (workspace: WorkspaceSnapshot) => ({
  sets: workspace.sets.length,
  places: new Set([
    ...workspace.savedPlaces.map((place) => place.id),
    ...workspace.sets.flatMap((set) =>
      set.timeline.flatMap((entry) => entry.type === 'place' ? [entry.place.id] : [])
    ),
  ]).size,
  savedPlaces: workspace.savedPlaces.length,
  folders: workspace.savedFolders.length,
});
