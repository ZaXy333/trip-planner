import { supabase } from '../supabase';
import type {
  Place,
  RouteInfo,
  SavedFolder,
  TimelineEntry,
  TripSet,
} from '../../types/trip';
import type { WorkspaceSettings, WorkspaceSnapshot } from './workspaceTypes';

export interface SearchHistoryRecord {
  id: string;
  query: string;
  searchType: string | null;
  selectedPlaceId: string | null;
  createdAt: number;
}

export interface RecommendationHistoryRecord {
  id: string;
  region: string;
  categories: string[];
  criteria: Record<string, unknown>;
  createdAt: number;
}

interface DbPlace {
  id: string;
  source: string | null;
  source_place_id: string | null;
  name: string;
  lat: number;
  lng: number;
  category: string | null;
  user_description: string | null;
  address: string | null;
  tags: string[] | null;
  rating: number | null;
  user_ratings_total: number | null;
  photo_url: string | null;
  metadata: Record<string, unknown> | null;
}

interface DbEntry {
  id: string;
  client_id: string | null;
  entry_type: 'place' | 'day_break';
  position: number;
  place_id: string | null;
  place: DbPlace | DbPlace[] | null;
}

interface DbTripSet {
  id: string;
  client_id: string | null;
  name: string;
  description: string | null;
  created_at: string;
  trip_entries: DbEntry[];
}

const DEFAULT_SETTINGS: WorkspaceSettings = {
  theme: 'light',
  dayViewSetting: 'tabs',
  mapStyle: 'standard',
  travelMode: 'WALKING',
  activeSetId: '',
  activeDayNumber: 1,
  recommendationRegion: '',
  recommendationCategories: ['monuments', 'restaurants', 'cafes'],
};

const sourceForPlace = (placeId: string) => {
  if (placeId.startsWith('osm-')) return 'osm';
  if (placeId.startsWith('custom-')) return 'custom';
  if (placeId.startsWith('geo-')) return 'geocoding';
  return 'google';
};

const placeFromDb = (row: DbPlace): Place => {
  const metadata = row.metadata ?? {};
  return {
    id: row.source_place_id || row.id,
    name: row.name,
    category: row.category || 'Miejsce',
    tier: metadata.tier === 2 ? 2 : 1,
    lat: Number(row.lat),
    lng: Number(row.lng),
    description: row.user_description || '',
    address: row.address || undefined,
    tags: row.tags || [],
    rating: row.rating == null ? undefined : Number(row.rating),
    userRatingsTotal: row.user_ratings_total || undefined,
    photoUrl: row.photo_url || undefined,
  };
};

const dateToEpoch = (value: string | null | undefined) => {
  const time = value ? Date.parse(value) : Date.now();
  return Number.isFinite(time) ? time : Date.now();
};

const getUserId = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Zaloguj się, aby zapisywać dane.');
  return data.user.id;
};

const throwIfError = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export const TripRepository = {
  async loadWorkspace(expectedUserId?: string): Promise<WorkspaceSnapshot & { hasRemoteData: boolean }> {
    const userId = await getUserId();
    if (expectedUserId && userId !== expectedUserId) {
      throw new Error('Sesja użytkownika zmieniła się podczas ładowania danych.');
    }
    const [settingsResult, setsResult, foldersResult, savedPlacesResult, linksResult, routesResult] = await Promise.all([
      supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase
        .from('trip_sets')
        .select(`
          id, client_id, name, description, created_at, position,
          trip_entries:trip_entries!trip_entries_trip_set_id_fkey(
            id, client_id, entry_type, position, place_id,
            place:places!trip_entries_place_id_fkey(
              id, source, source_place_id, name, lat, lng, category,
              user_description, address, tags, rating, user_ratings_total,
              photo_url, metadata
            )
          )
        `)
        .eq('user_id', userId)
        .order('position', { ascending: true }),
      supabase
        .from('saved_folders')
        .select('id, client_id, name, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      supabase
        .from('saved_places')
        .select(`id, place_id, place:places!saved_places_place_id_fkey(
          id, source, source_place_id, name, lat, lng, category,
          user_description, address, tags, rating, user_ratings_total,
          photo_url, metadata
        )`)
        .eq('user_id', userId),
      supabase.from('saved_folder_places').select('folder_id, saved_place_id'),
      supabase
        .from('trip_routes')
        .select('trip_set_id, day_number, route_data')
        .eq('user_id', userId),
    ]);

    throwIfError(settingsResult.error);
    throwIfError(setsResult.error);
    throwIfError(foldersResult.error);
    throwIfError(savedPlacesResult.error);
    throwIfError(linksResult.error);
    throwIfError(routesResult.error);

    const settingsRow = settingsResult.data;
    const settingsPreferences = (settingsRow?.preferences || {}) as Record<string, unknown>;
    const dbSets = (setsResult.data || []) as unknown as DbTripSet[];
    const dbFolders = foldersResult.data || [];
    const dbSavedPlaces = savedPlacesResult.data || [];
    const dbLinks = linksResult.data || [];
    const routeRows = routesResult.data || [];

    const folderIdsBySavedPlace = new Map<string, string[]>();
    const folderClientIdByDbId = new Map(
      dbFolders.map((folder) => [folder.id, folder.client_id || folder.id])
    );
    for (const link of dbLinks) {
      const clientFolderId = folderClientIdByDbId.get(link.folder_id);
      if (!clientFolderId) continue;
      const current = folderIdsBySavedPlace.get(link.saved_place_id) || [];
      current.push(clientFolderId);
      folderIdsBySavedPlace.set(link.saved_place_id, current);
    }

    const routesBySet = new Map<string, Record<number, RouteInfo>>();
    for (const route of routeRows) {
      const routes = routesBySet.get(route.trip_set_id) || {};
      routes[route.day_number] = route.route_data as RouteInfo;
      routesBySet.set(route.trip_set_id, routes);
    }

    const sets: TripSet[] = dbSets.map((set) => ({
      id: set.client_id || set.id,
      name: set.name,
      description: set.description || undefined,
      createdAt: dateToEpoch(set.created_at),
      timeline: [...(set.trip_entries || [])]
        .sort((left, right) => left.position - right.position)
        .flatMap((entry): TimelineEntry[] => {
          if (entry.entry_type === 'day_break') {
            return [{ type: 'day_break', id: entry.client_id || entry.id }];
          }
          const place = Array.isArray(entry.place) ? entry.place[0] : entry.place;
          if (!place) return [];
          return [{
            type: 'place',
            id: entry.client_id || entry.id,
            place: placeFromDb(place),
          }];
        }),
      routesByDay: routesBySet.get(set.id) || {},
    }));

    const savedPlaces: Place[] = dbSavedPlaces.flatMap((row) => {
      const place = Array.isArray(row.place) ? row.place[0] : row.place;
      if (!place) return [];
      return [{
        ...placeFromDb(place),
        folderIds: folderIdsBySavedPlace.get(row.id) || [],
      }];
    });

    const savedFolders: SavedFolder[] = dbFolders.map((folder) => ({
      id: folder.client_id || folder.id,
      name: folder.name,
      createdAt: dateToEpoch(folder.created_at),
    }));

    const workspaceSettings: WorkspaceSettings = {
      theme: settingsRow?.theme === 'dark' ? 'dark' : 'light',
      dayViewSetting: settingsRow?.day_view === 'timeline' ? 'timeline' : 'tabs',
      mapStyle: settingsRow?.map_style === 'satellite' ? 'satellite' : 'standard',
      travelMode: settingsRow?.travel_mode === 'DRIVING' ? 'DRIVING' : 'WALKING',
      activeSetId: typeof settingsPreferences.activeSetId === 'string'
        ? settingsPreferences.activeSetId
        : '',
      activeDayNumber: typeof settingsPreferences.activeDayNumber === 'number'
        ? settingsPreferences.activeDayNumber
        : 1,
      recommendationRegion: typeof settingsPreferences.recommendationRegion === 'string'
        ? settingsPreferences.recommendationRegion
        : '',
      recommendationCategories: Array.isArray(settingsPreferences.recommendationCategories)
        ? settingsPreferences.recommendationCategories.filter((item): item is string => typeof item === 'string')
        : DEFAULT_SETTINGS.recommendationCategories,
    };

    return {
      sets,
      savedPlaces,
      savedFolders,
      settings: workspaceSettings,
      hasRemoteData: Boolean(settingsRow || sets.length || savedPlaces.length || savedFolders.length),
    };
  },

  async saveWorkspace(workspace: WorkspaceSnapshot, expectedUserId?: string) {
    const userId = await getUserId();
    if (expectedUserId && userId !== expectedUserId) {
      throw new Error('Sesja użytkownika zmieniła się przed zapisem danych.');
    }
    const uniquePlaces = new Map<string, Place>();
    workspace.sets.forEach((set) => {
      set.timeline.forEach((entry) => {
        if (entry.type === 'place') uniquePlaces.set(entry.place.id, entry.place);
      });
    });
    workspace.savedPlaces.forEach((place) => uniquePlaces.set(place.id, place));

    const placeRows = Array.from(uniquePlaces.values()).map((place) => ({
      user_id: userId,
      source: sourceForPlace(place.id),
      source_place_id: place.id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      category: place.category,
      user_description: place.description,
      address: place.address || null,
      tags: place.tags || [],
      rating: place.rating ?? null,
      user_ratings_total: place.userRatingsTotal ?? null,
      photo_url: place.photoUrl || null,
      metadata: { tier: place.tier },
    }));

    const dbPlaceIds = new Map<string, string>();
    if (placeRows.length) {
      const { data, error } = await supabase
        .from('places')
        .upsert(placeRows, { onConflict: 'user_id,source,source_place_id' })
        .select('id, source_place_id');
      throwIfError(error);
      (data || []).forEach((row) => dbPlaceIds.set(row.source_place_id, row.id));
    }

    const setRows = workspace.sets.map((set, position) => ({
      user_id: userId,
      client_id: set.id,
      name: set.name,
      description: set.description || null,
      position,
      ...(Number.isFinite(set.createdAt) ? { created_at: new Date(set.createdAt).toISOString() } : {}),
    }));
    const dbSetIds = new Map<string, string>();
    if (setRows.length) {
      const { data, error } = await supabase
        .from('trip_sets')
        .upsert(setRows, { onConflict: 'user_id,client_id' })
        .select('id, client_id');
      throwIfError(error);
      (data || []).forEach((row) => dbSetIds.set(row.client_id, row.id));
    }

    const entryRows = workspace.sets.flatMap((set) => {
      const tripSetId = dbSetIds.get(set.id);
      if (!tripSetId) return [];
      return set.timeline.map((entry, position) => ({
        user_id: userId,
        client_id: entry.id,
        trip_set_id: tripSetId,
        entry_type: entry.type,
        place_id: entry.type === 'place' ? dbPlaceIds.get(entry.place.id) || null : null,
        position,
      }));
    });
    const { data: existingEntries, error: existingEntriesError } = await supabase
      .from('trip_entries')
      .select('id, client_id')
      .eq('user_id', userId);
    throwIfError(existingEntriesError);
    if (entryRows.length) {
      const { error } = await supabase
        .from('trip_entries')
        .upsert(entryRows, { onConflict: 'user_id,client_id' });
      throwIfError(error);
    }
    const desiredEntryIds = new Set(entryRows.map((entry) => entry.client_id));
    const staleEntryIds = (existingEntries || [])
      .filter((entry) => !entry.client_id || !desiredEntryIds.has(entry.client_id))
      .map((entry) => entry.id);
    if (staleEntryIds.length) {
      const { error } = await supabase.from('trip_entries').delete().in('id', staleEntryIds);
      throwIfError(error);
    }

    const { data: existingSets, error: existingSetsError } = await supabase
      .from('trip_sets')
      .select('id, client_id')
      .eq('user_id', userId);
    throwIfError(existingSetsError);
    const desiredSetIds = new Set(workspace.sets.map((set) => set.id));
    const staleSetIds = (existingSets || [])
      .filter((set) => !set.client_id || !desiredSetIds.has(set.client_id))
      .map((set) => set.id);
    if (staleSetIds.length) {
      const { error } = await supabase.from('trip_sets').delete().in('id', staleSetIds);
      throwIfError(error);
    }

    const routeRows = workspace.sets.flatMap((set) => {
      const tripSetId = dbSetIds.get(set.id);
      if (!tripSetId) return [];
      return Object.entries(set.routesByDay || {}).map(([dayNumber, route]) => ({
        user_id: userId,
        trip_set_id: tripSetId,
        day_number: Number(dayNumber),
        route_data: route,
      }));
    });
    const { error: deleteRoutesError } = await supabase
      .from('trip_routes')
      .delete()
      .eq('user_id', userId);
    throwIfError(deleteRoutesError);
    if (routeRows.length) {
      const { error } = await supabase.from('trip_routes').insert(routeRows);
      throwIfError(error);
    }

    const folderRows = workspace.savedFolders.map((folder) => ({
      user_id: userId,
      client_id: folder.id,
      name: folder.name,
      ...(Number.isFinite(folder.createdAt) ? { created_at: new Date(folder.createdAt).toISOString() } : {}),
    }));
    const dbFolderIds = new Map<string, string>();
    if (folderRows.length) {
      const { data, error } = await supabase
        .from('saved_folders')
        .upsert(folderRows, { onConflict: 'user_id,client_id' })
        .select('id, client_id');
      throwIfError(error);
      (data || []).forEach((row) => dbFolderIds.set(row.client_id, row.id));
    }

    const desiredDbPlaceIds = Array.from(new Set(workspace.savedPlaces
      .map((place) => dbPlaceIds.get(place.id))
      .filter((id): id is string => Boolean(id))));
    if (desiredDbPlaceIds.length) {
      const { error } = await supabase
        .from('saved_places')
        .upsert(
          desiredDbPlaceIds.map((place_id) => ({ user_id: userId, place_id })),
          { onConflict: 'user_id,place_id', ignoreDuplicates: true }
        )
        .select('id, place_id');
      throwIfError(error);
    }
    const { data: existingSavedPlaces, error: existingSavedError } = await supabase
      .from('saved_places')
      .select('id, place_id')
      .eq('user_id', userId);
    throwIfError(existingSavedError);
    const savedIdByPlaceId = new Map<string, string>(
      (existingSavedPlaces || []).map((row) => [row.place_id, row.id])
    );

    const desiredLinks = new Set<string>();
    const linkRows = workspace.savedPlaces.flatMap((place) => {
      const dbPlaceId = dbPlaceIds.get(place.id);
      const savedPlaceId = dbPlaceId ? savedIdByPlaceId.get(dbPlaceId) : undefined;
      if (!savedPlaceId) return [];
      return (place.folderIds || []).flatMap((folderClientId) => {
        const folderId = dbFolderIds.get(folderClientId);
        if (!folderId) return [];
        desiredLinks.add(`${folderId}:${savedPlaceId}`);
        return [{ folder_id: folderId, saved_place_id: savedPlaceId }];
      });
    });
    const { data: existingLinks, error: existingLinksError } = await supabase
      .from('saved_folder_places')
      .select('folder_id, saved_place_id');
    throwIfError(existingLinksError);
    const staleLinks = (existingLinks || []).filter(
      (link) => !desiredLinks.has(`${link.folder_id}:${link.saved_place_id}`)
    );
    for (const link of staleLinks) {
      const { error } = await supabase
        .from('saved_folder_places')
        .delete()
        .eq('folder_id', link.folder_id)
        .eq('saved_place_id', link.saved_place_id);
      throwIfError(error);
    }
    if (linkRows.length) {
      const { error } = await supabase
        .from('saved_folder_places')
        .upsert(linkRows, { onConflict: 'folder_id,saved_place_id', ignoreDuplicates: true });
      throwIfError(error);
    }

    const desiredSavedPlaceIds = new Set(desiredDbPlaceIds);
    const staleSavedIds = (existingSavedPlaces || [])
      .filter((row) => !desiredSavedPlaceIds.has(row.place_id))
      .map((row) => row.id);
    if (staleSavedIds.length) {
      const { error } = await supabase.from('saved_places').delete().in('id', staleSavedIds);
      throwIfError(error);
    }

    const { data: existingFolders, error: existingFoldersError } = await supabase
      .from('saved_folders')
      .select('id, client_id')
      .eq('user_id', userId);
    throwIfError(existingFoldersError);
    const desiredFolderIds = new Set(workspace.savedFolders.map((folder) => folder.id));
    const staleFolderIds = (existingFolders || [])
      .filter((folder) => !folder.client_id || !desiredFolderIds.has(folder.client_id))
      .map((folder) => folder.id);
    if (staleFolderIds.length) {
      const { error } = await supabase.from('saved_folders').delete().in('id', staleFolderIds);
      throwIfError(error);
    }

    const { error: settingsError } = await supabase
      .from('user_settings')
      .upsert({
        user_id: userId,
        theme: workspace.settings.theme,
        day_view: workspace.settings.dayViewSetting,
        map_style: workspace.settings.mapStyle,
        travel_mode: workspace.settings.travelMode,
        preferences: {
          activeSetId: workspace.settings.activeSetId,
          activeDayNumber: workspace.settings.activeDayNumber,
          recommendationRegion: workspace.settings.recommendationRegion,
          recommendationCategories: workspace.settings.recommendationCategories,
          migration_v1_complete: true,
        },
      });
    throwIfError(settingsError);
  },

  async recordSearch(
    query: string,
    searchType: string,
    selectedPlaceId?: string,
    expectedUserId?: string
  ) {
    const userId = await getUserId();
    if (expectedUserId && userId !== expectedUserId) {
      throw new Error('Sesja użytkownika zmieniła się przed zapisem historii.');
    }
    const trimmed = query.trim();
    if (!trimmed) return;
    const { error } = await supabase.from('search_history').insert({
      user_id: userId,
      query: trimmed,
      search_type: searchType,
      selected_place_id: selectedPlaceId || null,
    });
    throwIfError(error);
  },

  async recordRecommendationSearch(
    region: string,
    categories: string[],
    criteria: Record<string, unknown> = {},
    expectedUserId?: string
  ) {
    const userId = await getUserId();
    if (expectedUserId && userId !== expectedUserId) {
      throw new Error('Sesja użytkownika zmieniła się przed zapisem wyszukiwania.');
    }
    const { error } = await supabase.from('recommendation_searches').insert({
      user_id: userId,
      region: region.trim() || null,
      categories,
      criteria,
    });
    throwIfError(error);
  },
};
