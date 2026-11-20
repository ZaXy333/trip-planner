import React, { useState, useEffect, useCallback, useRef } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { AuthGate } from './components/AuthGate';
import { useAuth } from './auth/authContext';
import { Map as MapComponent } from './components/Map';
import type {
  MapFocusTarget,
  SecondaryMapPlace,
  MapBoundsInfo,
} from './components/Map';
import type {
  Place,
  MapStyle,
  TripSet,
  TravelModeOption,
  DayViewSetting,
  SavedFolder,
} from './types/trip';
import {
  createEmptyWorkspace,
  getLegacyDataCounts,
  readLegacyWorkspace,
} from './lib/api/migration';
import { TripRepository } from './lib/api/tripRepository';
import type { WorkspaceSnapshot } from './lib/api/workspaceTypes';
import {
  PlaceAutocomplete,
  type PlaceSelectMeta,
} from './components/PlaceAutocomplete';
import {
  RECOMMENDATION_CATEGORIES,
  fetchRecommendedPlaces,
} from './utils/googlePlaces';
import {
  AVAILABLE_CUSTOM_TAGS,
  calculateTripRoute,
  createDayBreakEntry,
  createNewSavedFolder,
  createNewTripSet,
  createPlaceEntry,
  deriveDaysFromTimeline,
  normalizeTripSet,
  optimizeRoute2Opt,
  replaceDayPlacesInTimeline,
} from './utils/routeUtils';
import {
  Compass,
  Layers,
  MapPin,
  X,
  Map as MapIcon,
  Plus,
  FolderOpen,
  FolderPlus,
  Folder,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  Route,
  Footprints,
  Car,
  Calendar,
  Tag,
  Check,
  Star,
  ArrowRight,
  Edit3,
  Bookmark,
  CheckSquare,
  Square,
  Settings,
  SplitSquareVertical,
  Eye,
  Sparkles,
  Search,
  Sun,
  Moon,
  LogOut,
} from 'lucide-react';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const STORAGE_KEY = 'trip_planner_sets_v2';
const LEGACY_STORAGE_KEY = 'trip_planner_sets_v1';
const SAVED_PLACES_KEY = 'trip_planner_saved_places_v1';
const SAVED_FOLDERS_KEY = 'trip_planner_saved_folders_v1';
const SETTINGS_KEY = 'trip_planner_settings_v1';
type AppTheme = 'light' | 'dark';

/**
 * Wyświetla ocenę wyłącznie w postaci 5 gwiazdek.
 */
const StarRating = ({ rating }: { rating?: number }) => {
  if (!rating || rating <= 0) return null;
  const rounded = Math.round(rating);
  return (
    <div
      className="inline-flex items-center gap-0.5"
      title={`Ocena: ${rating.toFixed(1)} / 5`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`h-3.5 w-3.5 ${
            star <= rounded
              ? 'fill-amber-400 text-amber-400'
              : 'fill-slate-200 text-slate-200'
          }`}
        />
      ))}
    </div>
  );
};

const createInitialSets = (): TripSet[] => {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((s: TripSet) => normalizeTripSet(s));
      }
    }
  } catch {
    // Ignoruj błędy parsowania localStorage
  }

  return [
    {
      id: 'set-default-prague',
      name: 'Weekend w Pradze',
      createdAt: Date.now(),
      timeline: [
        createPlaceEntry({
          id: 'ChIJi3lwCZyTC0cRkEAWZg-vAAQ',
          name: 'Most Karola',
          category: 'Zabytek',
          tier: 1,
          lat: 50.08647,
          lng: 14.41143,
          description: '',
          address: 'Karlův most, 110 00 Praha 1, Czechy',
          tags: ['Zabytek', 'Punkt widokowy'],
          rating: 4.8,
        }),
        createPlaceEntry({
          id: 'ChIJrc9T95yTC0cR4Ja22g-vAAQ',
          name: 'Zamek na Hradczanach',
          category: 'Zabytek',
          tier: 1,
          lat: 50.09109,
          lng: 14.4016,
          description: '',
          address: 'Hradčany, 119 08 Praha 1, Czechy',
          tags: ['Zabytek'],
          rating: 4.7,
        }),
        createDayBreakEntry(),
      ],
      routesByDay: {},
    },
  ];
};

const createInitialSavedPlaces = (): Place[] => {
  try {
    const raw = localStorage.getItem(SAVED_PLACES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item: Place & { folderId?: string }) => {
          const normalizedFolderIds = Array.isArray(item.folderIds)
            ? item.folderIds
            : item.folderId
            ? [item.folderId]
            : [];
          return {
            ...item,
            folderIds: normalizedFolderIds,
          };
        });
      }
    }
  } catch {
    // Ignoruj błędy
  }
  return [];
};

const createInitialSavedFolders = (): SavedFolder[] => {
  try {
    const raw = localStorage.getItem(SAVED_FOLDERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // Ignoruj błędy
  }
  return [];
};

const loadInitialDayViewSetting = (): DayViewSetting => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { dayViewSetting?: DayViewSetting };
      if (
        parsed.dayViewSetting === 'tabs' ||
        parsed.dayViewSetting === 'timeline'
      ) {
        return parsed.dayViewSetting;
      }
    }
  } catch {
    // Ignoruj
  }
  return 'tabs';
};

const loadInitialTheme = (): AppTheme => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { theme?: AppTheme };
      if (parsed.theme === 'light' || parsed.theme === 'dark') {
        return parsed.theme;
      }
    }
  } catch {
    // Ignoruj błędy odczytu
  }
  return 'light';
};

type PanelViewMode =
  | 'plan'
  | 'sets'
  | 'saved'
  | 'recommendations'
  | 'settings';

function TripPlannerApp() {
  const { user, logout } = useAuth();
  const [isWorkspaceReady, setIsWorkspaceReady] = useState(false);
  const [pendingLocalImport, setPendingLocalImport] =
    useState<WorkspaceSnapshot | null>(null);
  const [isImportingLocal, setIsImportingLocal] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceRetry, setWorkspaceRetry] = useState(0);
  const workspaceSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const [sets, setSets] = useState<TripSet[]>(createInitialSets);
  const [savedPlaces, setSavedPlaces] = useState<Place[]>(
    createInitialSavedPlaces
  );
  const [savedFolders, setSavedFolders] = useState<SavedFolder[]>(
    createInitialSavedFolders
  );
  const [activeFolderFilter, setActiveFolderFilter] = useState<string>('all');
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Sposób 1: Przeciąganie miejsc do folderów
  const [draggedSavedPlaceId, setDraggedSavedPlaceId] = useState<string | null>(
    null
  );
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  // Sposób 2: Przycisk "+" po prawej stronie miejsca -> modal z checklistą folderów
  const [placesForFolderChecklistModal, setPlacesForFolderChecklistModal] =
    useState<Place[] | null>(null);
  const [checkedFolderIdsInModal, setCheckedFolderIdsInModal] = useState<
    string[]
  >([]);

  // Sposób 3: Po wejściu w folder u góry opcja "Dodaj" -> modal z checklistą zapisanych miejsc
  const [folderForPlacesChecklistModal, setFolderForPlacesChecklistModal] =
    useState<SavedFolder | null>(null);
  const [checkedPlaceIdsInFolderModal, setCheckedPlaceIdsInFolderModal] =
    useState<string[]>([]);

  const [dayViewSetting, setDayViewSetting] = useState<DayViewSetting>(
    loadInitialDayViewSetting
  );
  const [theme, setTheme] = useState<AppTheme>(loadInitialTheme);

  const [activeSetId, setActiveSetId] = useState<string>('');
  const [activeDayNumber, setActiveDayNumber] = useState<number>(1);

  // Widok w panelu: 'plan' (aktywny set), 'sets' (lista setów), 'saved' (zapisane), 'settings' (ustawienia)
  const [panelView, setPanelView] = useState<PanelViewMode>('plan');
  // Czy w otwartym secie jesteśmy w trybie edycji (przesuwanie miejsc i <br>), czy w podglądzie
  const [isSetEditMode, setIsSetEditMode] = useState(false);

  const [newSetName, setNewSetName] = useState('');
  const [isCreatingSet, setIsCreatingSet] = useState(false);
  const [isEditingSetName, setIsEditingSetName] = useState(false);
  const [editedSetName, setEditedSetName] = useState('');

  // Zaznaczanie wielu miejsc w Zapisanych + Modal wyboru setu
  const [isSelectModeInSaved, setIsSelectModeInSaved] = useState(false);
  const [selectedSavedIds, setSelectedSavedIds] = useState<string[]>([]);
  const [placesForModal, setPlacesForModal] = useState<Place[] | null>(null);
  const [modalSetId, setModalSetId] = useState<string>('');

  // Aktualnie wybrane miejsce (z wyszukiwarki lub kliknięcia w obiekt)
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [customTagInput, setCustomTagInput] = useState('');

  const [mapFocus, setMapFocus] = useState<MapFocusTarget | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [mapStyle, setMapStyle] = useState<MapStyle>('standard');
  const hasUserChosenMapFocus = useRef(false);

  // Stan zakładki Polecane
  const [recRegionQuery, setRecRegionQuery] = useState('');
  const [selectedRecCategories, setSelectedRecCategories] = useState<string[]>([
    'monuments',
    'restaurants',
    'cafes',
  ]);
  const [recommendedPlaces, setRecommendedPlaces] = useState<Place[]>([]);
  const [isSearchingRecommendations, setIsSearchingRecommendations] =
    useState(false);
  const [hasSearchedRecommendations, setHasSearchedRecommendations] =
    useState(false);
  const [isMapMovedInRecommendations, setIsMapMovedInRecommendations] =
    useState(false);
  const currentMapBoundsRef = useRef<MapBoundsInfo | null>(null);

  // Stan obliczania trasy i Drag & Drop na osi czasu
  const [travelMode, setTravelMode] = useState<TravelModeOption>('WALKING');
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [draggedTimelineIdx, setDraggedTimelineIdx] = useState<number | null>(
    null
  );
  const [dragOverTimelineIdx, setDragOverTimelineIdx] = useState<number | null>(
    null
  );

  const applyWorkspace = useCallback((workspace: WorkspaceSnapshot) => {
    setSets(workspace.sets);
    setSavedPlaces(workspace.savedPlaces);
    setSavedFolders(workspace.savedFolders);
    setTheme(workspace.settings.theme);
    setDayViewSetting(workspace.settings.dayViewSetting);
    setMapStyle(workspace.settings.mapStyle);
    setTravelMode(workspace.settings.travelMode);
    setActiveSetId(workspace.settings.activeSetId);
    setActiveDayNumber(workspace.settings.activeDayNumber);
    setRecRegionQuery(workspace.settings.recommendationRegion);
    setSelectedRecCategories(workspace.settings.recommendationCategories);
  }, []);

  useEffect(() => {
    let active = true;

    const loadWorkspace = async () => {
      setWorkspaceError('');
      try {
        const remoteWorkspace = await TripRepository.loadWorkspace();
        if (!active) return;

        if (remoteWorkspace.hasRemoteData) {
          applyWorkspace(remoteWorkspace);
          setIsWorkspaceReady(true);
          return;
        }

        const legacyWorkspace = readLegacyWorkspace();
        if (legacyWorkspace) {
          setPendingLocalImport(legacyWorkspace);
          return;
        }

        setIsWorkspaceReady(true);
      } catch (error) {
        if (!active) return;
        setWorkspaceError(
          error instanceof Error
            ? error.message
            : 'Nie udało się pobrać danych z Supabase.'
        );
      }
    };

    void loadWorkspace();
    return () => {
      active = false;
    };
  }, [applyWorkspace, user.id, workspaceRetry]);

  const handleImportLocalWorkspace = async () => {
    if (!pendingLocalImport) return;
    setIsImportingLocal(true);
    setWorkspaceError('');
    try {
      await TripRepository.saveWorkspace(pendingLocalImport, user.id);
      applyWorkspace(pendingLocalImport);
      setPendingLocalImport(null);
      setIsWorkspaceReady(true);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error
          ? error.message
          : 'Nie udało się przenieść lokalnych danych.'
      );
    } finally {
      setIsImportingLocal(false);
    }
  };

  const handleStartFreshWorkspace = () => {
    if (pendingLocalImport) {
      try {
        localStorage.setItem(
          'trip_planner_pre_supabase_backup_v1',
          JSON.stringify(pendingLocalImport)
        );
      } catch {
        setWorkspaceError('Nie udało się zabezpieczyć lokalnej kopii danych.');
        return;
      }
    }
    applyWorkspace(createEmptyWorkspace());
    setPendingLocalImport(null);
    setIsWorkspaceReady(true);
  };

  useEffect(() => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (hasUserChosenMapFocus.current) return;
        setMapFocus({
          lat: coords.latitude,
          lng: coords.longitude,
          zoom: 14,
        });
      },
      () => undefined,
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 }
    );
  }, []);

  useEffect(() => {
    if (!isWorkspaceReady || pendingLocalImport) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
    } catch {
      // Ignoruj błędy zapisu
    }
  }, [isWorkspaceReady, pendingLocalImport, sets]);

  useEffect(() => {
    if (!isWorkspaceReady || pendingLocalImport) return;
    try {
      localStorage.setItem(SAVED_PLACES_KEY, JSON.stringify(savedPlaces));
    } catch {
      // Ignoruj błędy zapisu
    }
  }, [isWorkspaceReady, pendingLocalImport, savedPlaces]);

  useEffect(() => {
    if (!isWorkspaceReady || pendingLocalImport) return;
    try {
      localStorage.setItem(SAVED_FOLDERS_KEY, JSON.stringify(savedFolders));
    } catch {
      // Ignoruj błędy zapisu
    }
  }, [isWorkspaceReady, pendingLocalImport, savedFolders]);

  useEffect(() => {
    if (!isWorkspaceReady || pendingLocalImport) return;
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          dayViewSetting,
          theme,
          mapStyle,
          travelMode,
          activeSetId,
          activeDayNumber,
          recommendationRegion: recRegionQuery,
          recommendationCategories: selectedRecCategories,
        })
      );
    } catch {
      // Ignoruj błędy zapisu
    }
  }, [
    activeDayNumber,
    activeSetId,
    dayViewSetting,
    isWorkspaceReady,
    mapStyle,
    pendingLocalImport,
    recRegionQuery,
    selectedRecCategories,
    theme,
    travelMode,
  ]);

  useEffect(() => {
    if (!isWorkspaceReady || pendingLocalImport) return;

    const snapshot: WorkspaceSnapshot = {
      sets,
      savedPlaces,
      savedFolders,
      settings: {
        theme,
        dayViewSetting,
        mapStyle,
        travelMode,
        activeSetId,
        activeDayNumber,
        recommendationRegion: recRegionQuery,
        recommendationCategories: selectedRecCategories,
      },
    };
    const timer = window.setTimeout(() => {
      workspaceSaveQueue.current = workspaceSaveQueue.current
        .catch(() => undefined)
        .then(() => TripRepository.saveWorkspace(snapshot, user.id))
        .then(() => setWorkspaceError(''))
        .catch((error: unknown) => {
          setWorkspaceError(
            error instanceof Error
              ? `Nie udało się zapisać danych: ${error.message}`
              : 'Nie udało się zapisać danych w Supabase.'
          );
        });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [
    activeDayNumber,
    activeSetId,
    dayViewSetting,
    isWorkspaceReady,
    mapStyle,
    pendingLocalImport,
    recRegionQuery,
    savedFolders,
    savedPlaces,
    selectedRecCategories,
    sets,
    theme,
    travelMode,
    user.id,
  ]);

  // Aktywny set jest ustawiony tylko wtedy, gdy jesteśmy w widoku 'plan'
  const activeSet: TripSet | null =
    panelView === 'plan'
      ? sets.find((s) => s.id === activeSetId) || null
      : null;

  const derivedDays = activeSet
    ? deriveDaysFromTimeline(activeSet.timeline, activeSet.routesByDay)
    : [];

  const activeDerivedDay =
    derivedDays.find((d) => d.dayNumber === activeDayNumber) ||
    derivedDays[0] ||
    null;

  const allPlacesInActiveSet = activeSet
    ? activeSet.timeline
        .filter(
          (entry): entry is Extract<typeof entry, { type: 'place' }> =>
            entry.type === 'place'
        )
        .map((entry) => entry.place)
    : [];

  const modalTargetSet =
    sets.find((s) => s.id === modalSetId) || sets[0] || null;

  // Dociągnięcie zdjęcia z Google dla istniejących miejsc
  const handlePlacePhotoLoaded = useCallback(
    (placeId: string, photoUrl: string) => {
      setSelectedPlace((prev) =>
        prev && prev.id === placeId ? { ...prev, photoUrl } : prev
      );
      setSets((prev) =>
        prev.map((set) => ({
          ...set,
          timeline: set.timeline.map((entry) =>
            entry.type === 'place' && entry.place.id === placeId
              ? { ...entry, place: { ...entry.place, photoUrl } }
              : entry
          ),
        }))
      );
      setSavedPlaces((prev) =>
        prev.map((p) => (p.id === placeId ? { ...p, photoUrl } : p))
      );
      setRecommendedPlaces((prev) =>
        prev.map((p) => (p.id === placeId ? { ...p, photoUrl } : p))
      );
    },
    []
  );

  // Wejście w Zapisane opuszcza aktualny set (ponowne kliknięcie w otwartą zakładkę chowa panel)
  const handleEnterSavedView = () => {
    if (!isSidebarCollapsed && panelView === 'saved') {
      setIsSidebarCollapsed(true);
      return;
    }
    setActiveSetId('');
    setIsSetEditMode(false);
    setIsEditingSetName(false);
    setSelectedPlace(null);
    setIsSelectModeInSaved(false);
    setSelectedSavedIds([]);
    setIsSidebarCollapsed(false);
    setPanelView('saved');
  };

  // Wejście w Sety opuszcza aktualny set (ponowne kliknięcie w otwartą listę setów chowa panel)
  const handleEnterSetsView = () => {
    if (!isSidebarCollapsed && (panelView === 'sets' || (!activeSet && panelView === 'plan'))) {
      setIsSidebarCollapsed(true);
      return;
    }
    setActiveSetId('');
    setIsSetEditMode(false);
    setIsEditingSetName(false);
    setSelectedPlace(null);
    setIsSelectModeInSaved(false);
    setSelectedSavedIds([]);
    setIsSidebarCollapsed(false);
    setPanelView('sets');
  };

  // Wejście w Polecane (ponowne kliknięcie chowa panel)
  const handleEnterRecommendationsView = () => {
    if (!isSidebarCollapsed && panelView === 'recommendations') {
      setIsSidebarCollapsed(true);
      return;
    }
    setActiveSetId('');
    setIsSetEditMode(false);
    setIsEditingSetName(false);
    setSelectedPlace(null);
    setIsSelectModeInSaved(false);
    setSelectedSavedIds([]);
    setIsSidebarCollapsed(false);
    setPanelView('recommendations');
  };

  const handleToggleRecCategory = (catId: string) => {
    setSelectedRecCategories((prev) =>
      prev.includes(catId)
        ? prev.filter((id) => id !== catId)
        : [...prev, catId]
    );
  };

  const handleSearchRecommendations = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (selectedRecCategories.length === 0) return;

    const regionToUse = recRegionQuery.trim();
    setIsSearchingRecommendations(true);
    setHasSearchedRecommendations(true);
    setIsMapMovedInRecommendations(false);
    try {
      const result = await fetchRecommendedPlaces({
        regionQuery: regionToUse,
        selectedCategoryIds: selectedRecCategories,
        visibleBounds: currentMapBoundsRef.current,
      });
      setRecommendedPlaces(result.places);
      void TripRepository.recordRecommendationSearch(
        regionToUse,
        selectedRecCategories,
        { searchMode: 'region' },
        user.id
      ).catch((error: unknown) => {
        setWorkspaceError(error instanceof Error ? error.message : 'Nie udało się zapisać historii Polecanych.');
      });
      if (result.regionCenter) {
        hasUserChosenMapFocus.current = true;
        setMapFocus(result.regionCenter);
      }
    } finally {
      setIsSearchingRecommendations(false);
    }
  };

  const handleSearchOnVisibleMap = async () => {
    if (selectedRecCategories.length === 0) return;

    setIsSearchingRecommendations(true);
    setHasSearchedRecommendations(true);
    setIsMapMovedInRecommendations(false);
    try {
      const result = await fetchRecommendedPlaces({
        regionQuery: '',
        selectedCategoryIds: selectedRecCategories,
        visibleBounds: currentMapBoundsRef.current,
      });
      setRecommendedPlaces(result.places);
      void TripRepository.recordRecommendationSearch(
        '',
        selectedRecCategories,
        { searchMode: 'visible_map' },
        user.id
      ).catch((error: unknown) => {
        setWorkspaceError(error instanceof Error ? error.message : 'Nie udało się zapisać historii Polecanych.');
      });
    } finally {
      setIsSearchingRecommendations(false);
    }
  };

  // Wejście w Ustawienia (ponowne kliknięcie w otwarte ustawienia chowa panel)
  const handleEnterSettingsView = () => {
    if (!isSidebarCollapsed && panelView === 'settings') {
      setIsSidebarCollapsed(true);
      return;
    }
    setIsEditingSetName(false);
    setSelectedPlace(null);
    setIsSidebarCollapsed(false);
    setPanelView('settings');
  };

  // Otwarcie modala wyboru setu (dla pojedynczego miejsca lub wielu zaznaczonych)
  const openAddToSetModal = (placesToAdd: Place[]) => {
    if (placesToAdd.length === 0) return;
    const defaultSet = sets[0];
    if (defaultSet) {
      setModalSetId(defaultSet.id);
    }
    setPlacesForModal(placesToAdd);
  };

  // Tworzenie nowego setu -> otwiera podgląd nowego setu
  const handleCreateSet = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newSetName.trim() || `Wycieczka #${sets.length + 1}`;
    const newSet = createNewTripSet(trimmed);
    setSets((prev) => [newSet, ...prev]);
    setActiveSetId(newSet.id);
    setActiveDayNumber(1);
    setIsSetEditMode(false);
    setNewSetName('');
    setIsCreatingSet(false);
    setPanelView('plan');
  };

  // Otwieranie istniejącego setu -> zawsze zaczyna w trybie podglądu (bez edycji)
  const handleSelectExistingSet = (set: TripSet) => {
    setActiveSetId(set.id);
    setActiveDayNumber(1);
    setIsSetEditMode(false);
    setSelectedPlace(null);
    setPanelView('plan');
  };

  // Usuwanie setu
  const handleDeleteSet = (setId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const remaining = sets.filter((s) => s.id !== setId);
    if (remaining.length === 0) {
      const fallback = createNewTripSet('Mój pierwszy set');
      setSets([fallback]);
    } else {
      setSets(remaining);
    }
  };

  // Zmiana nazwy aktywnego setu
  const handleSaveSetName = () => {
    if (!activeSet) return;
    const trimmed = editedSetName.trim();
    if (trimmed) {
      setSets((prev) =>
        prev.map((s) => (s.id === activeSet.id ? { ...s, name: trimmed } : s))
      );
    }
    setIsEditingSetName(false);
  };

  // Wybór obiektu z wyszukiwarki lub mapy
  const handlePlaceInspect = (place: Place, customZoom = 16) => {
    const existingInSet = allPlacesInActiveSet.find((p) => p.id === place.id);
    const existingInSaved = savedPlaces.find((p) => p.id === place.id);
    const merged = existingInSet || existingInSaved || place;
    setSelectedPlace({
      ...merged,
      photoUrl: merged.photoUrl || place.photoUrl,
    });
    hasUserChosenMapFocus.current = true;
    setMapFocus({ lat: place.lat, lng: place.lng, zoom: customZoom });
    if (isSidebarCollapsed) {
      setIsSidebarCollapsed(false);
    }
  };

  const handleAutocompleteSelect = (place: Place, meta?: PlaceSelectMeta) => {
    void TripRepository.recordSearch(
      meta?.query || place.name,
      meta?.isCityOrRegion ? 'location' : 'place',
      place.id,
      user.id
    ).catch((error: unknown) => {
      setWorkspaceError(error instanceof Error ? error.message : 'Nie udało się zapisać historii wyszukiwania.');
    });
    if (meta?.isCityOrRegion) {
      hasUserChosenMapFocus.current = true;
      setMapFocus({ lat: place.lat, lng: place.lng, zoom: meta.zoom });
      return;
    }
    handlePlaceInspect(place, meta?.zoom ?? 16);
  };

  // Aktualizacja notatki (opisu) lub tagów wybranego miejsca
  const updateSelectedPlaceData = (updater: (p: Place) => Place) => {
    if (!selectedPlace) return;
    const updated = updater(selectedPlace);
    setSelectedPlace(updated);

    setSets((prev) =>
      prev.map((set) => ({
        ...set,
        timeline: set.timeline.map((entry) =>
          entry.type === 'place' && entry.place.id === updated.id
            ? { ...entry, place: updated }
            : entry
        ),
      }))
    );

    setSavedPlaces((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
  };

  const handleToggleTagOnSelected = (tag: string) => {
    updateSelectedPlaceData((p) => {
      const exists = p.tags.includes(tag);
      const nextTags = exists
        ? p.tags.filter((t) => t !== tag)
        : [...p.tags, tag];
      return { ...p, tags: nextTags };
    });
  };

  const handleAddCustomTag = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customTagInput.trim();
    if (!trimmed) return;
    updateSelectedPlaceData((p) => {
      if (p.tags.includes(trimmed)) return p;
      return { ...p, tags: [...p.tags, trimmed] };
    });
    setCustomTagInput('');
  };

  /**
   * Dodaje jedno lub wiele miejsc AUTOMATYCZNIE NA SAM KONIEC wybranego setu,
   * a następnie przenosi użytkownika do podglądu planu w tym secie.
   */
  const handleAddPlacesToSetEndAndGo = (
    placesToAdd: Place[],
    destSetId: string
  ) => {
    const destSet = sets.find((s) => s.id === destSetId) || sets[0];
    if (!destSet || placesToAdd.length === 0) return;

    const existingPlaceIds = new Set(
      destSet.timeline
        .filter(
          (e): e is Extract<typeof e, { type: 'place' }> => e.type === 'place'
        )
        .map((e) => e.place.id)
    );
    const uniqueNewEntries = placesToAdd
      .filter((p) => !existingPlaceIds.has(p.id))
      .map((p) => createPlaceEntry(p));

    const updatedTimeline = [...destSet.timeline, ...uniqueNewEntries];
    const updatedDays = deriveDaysFromTimeline(updatedTimeline);
    const lastDayNumber = updatedDays[updatedDays.length - 1]?.dayNumber || 1;

    setSets((prev) =>
      prev.map((set) => {
        if (set.id !== destSet.id) return set;
        return {
          ...set,
          timeline: updatedTimeline,
          routesByDay: {},
        };
      })
    );

    setPlacesForModal(null);
    setIsSelectModeInSaved(false);
    setSelectedSavedIds([]);
    setActiveSetId(destSet.id);
    setActiveDayNumber(lastDayNumber);
    setSelectedPlace(null);
    setPanelView('plan');
  };

  // Dodanie podziału dnia (<br>) na oś czasu w trybie edycji
  const handleAddDayBreakToTimeline = () => {
    if (!activeSet) return;
    const newBreak = createDayBreakEntry();
    setSets((prev) =>
      prev.map((s) =>
        s.id === activeSet.id
          ? {
              ...s,
              timeline: [...s.timeline, newBreak],
              routesByDay: {},
            }
          : s
      )
    );
  };

  // Przesuwanie dowolnego elementu (miejsca lub podziału <br>) na osi czasu w trybie edycji
  const handleMoveTimelineEntry = (fromIndex: number, toIndex: number) => {
    if (!activeSet) return;
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= activeSet.timeline.length ||
      toIndex >= activeSet.timeline.length
    ) {
      return;
    }

    const updated = [...activeSet.timeline];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);

    setSets((prev) =>
      prev.map((s) =>
        s.id === activeSet.id
          ? {
              ...s,
              timeline: updated,
              routesByDay: {},
            }
          : s
      )
    );
  };

  // Usunięcie elementu (miejsca lub podziału dnia <br>) z osi czasu w trybie edycji
  const handleRemoveTimelineEntry = (entryId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!activeSet) return;

    setSets((prev) =>
      prev.map((s) =>
        s.id === activeSet.id
          ? {
              ...s,
              timeline: s.timeline.filter((item) => item.id !== entryId),
              routesByDay: {},
            }
          : s
      )
    );
  };

  // Zapisywanie / usuwanie miejsca z globalnego zbioru "Zapisane"
  const handleToggleSavePlace = (place: Place) => {
    const initialFolderIds =
      panelView === 'saved' && activeFolderFilter !== 'all'
        ? Array.from(new Set([...(place.folderIds || []), activeFolderFilter]))
        : place.folderIds || [];

    setSavedPlaces((prev) => {
      const exists = prev.some((p) => p.id === place.id);
      if (exists) {
        return prev.filter((p) => p.id !== place.id);
      }
      return [{ ...place, folderIds: initialFolderIds }, ...prev];
    });
    setSelectedSavedIds((prev) => prev.filter((id) => id !== place.id));
  };

  // Tworzenie nowego folderu w Zapisanych
  const handleCreateFolder = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed =
      newFolderName.trim() || `Folder #${savedFolders.length + 1}`;
    const folder = createNewSavedFolder(trimmed);
    setSavedFolders((prev) => [...prev, folder]);
    setActiveFolderFilter(folder.id);
    setNewFolderName('');
    setIsCreatingFolder(false);
  };

  // Usuwanie folderu (miejsca zostają w Zapisanych, usuwamy tylko przypisanie do tego folderu)
  const handleDeleteFolder = (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSavedFolders((prev) => prev.filter((f) => f.id !== folderId));
    setSavedPlaces((prev) =>
      prev.map((p) => ({
        ...p,
        folderIds: (p.folderIds || []).filter((id) => id !== folderId),
      }))
    );
    if (activeFolderFilter === folderId) {
      setActiveFolderFilter('all');
    }
  };

  // Sposób 1: Upuszczenie przeciąganego miejsca na folder (dodaje miejsce do tego folderu, zachowując inne foldery)
  const handleDropPlaceOnFolder = (placeId: string, folderId: string) => {
    const idsToAdd =
      isSelectModeInSaved && selectedSavedIds.includes(placeId)
        ? selectedSavedIds
        : [placeId];
    const idSet = new Set(idsToAdd);

    setSavedPlaces((prev) =>
      prev.map((p) => {
        if (!idSet.has(p.id)) return p;
        const current = p.folderIds || [];
        if (current.includes(folderId)) return p;
        return { ...p, folderIds: [...current, folderId] };
      })
    );
  };

  // Sposób 2: Otwarcie modala z checklistą folderów po kliknięciu "+" po prawej stronie miejsca
  const openFolderChecklistModal = (placesToManage: Place[]) => {
    if (placesToManage.length === 0) return;
    const firstPlaceFolders = placesToManage[0].folderIds || [];
    const commonFolders =
      placesToManage.length === 1
        ? firstPlaceFolders
        : firstPlaceFolders.filter((fId) =>
            placesToManage.every((p) => (p.folderIds || []).includes(fId))
          );
    setCheckedFolderIdsInModal(commonFolders);
    setPlacesForFolderChecklistModal(placesToManage);
  };

  const handleToggleFolderInChecklistModal = (folderId: string) => {
    setCheckedFolderIdsInModal((prev) =>
      prev.includes(folderId)
        ? prev.filter((id) => id !== folderId)
        : [...prev, folderId]
    );
  };

  const handleSaveFolderChecklistModal = () => {
    if (!placesForFolderChecklistModal) return;
    const idSet = new Set(placesForFolderChecklistModal.map((p) => p.id));

    setSavedPlaces((prev) =>
      prev.map((p) =>
        idSet.has(p.id) ? { ...p, folderIds: [...checkedFolderIdsInModal] } : p
      )
    );
    if (selectedPlace && idSet.has(selectedPlace.id)) {
      setSelectedPlace((prev) =>
        prev ? { ...prev, folderIds: [...checkedFolderIdsInModal] } : null
      );
    }
    setPlacesForFolderChecklistModal(null);
    setIsSelectModeInSaved(false);
    setSelectedSavedIds([]);
  };

  // Sposób 3: Otwarcie modala z checklistą wszystkich zapisanych miejsc po kliknięciu "Dodaj" wewnątrz folderu
  const openPlacesChecklistForFolderModal = (folder: SavedFolder) => {
    const initialChecked = savedPlaces
      .filter((p) => (p.folderIds || []).includes(folder.id))
      .map((p) => p.id);
    setCheckedPlaceIdsInFolderModal(initialChecked);
    setFolderForPlacesChecklistModal(folder);
  };

  const handleTogglePlaceInFolderChecklistModal = (placeId: string) => {
    setCheckedPlaceIdsInFolderModal((prev) =>
      prev.includes(placeId)
        ? prev.filter((id) => id !== placeId)
        : [...prev, placeId]
    );
  };

  const handleSavePlacesChecklistForFolderModal = () => {
    if (!folderForPlacesChecklistModal) return;
    const targetFolderId = folderForPlacesChecklistModal.id;
    const checkedSet = new Set(checkedPlaceIdsInFolderModal);

    setSavedPlaces((prev) =>
      prev.map((p) => {
        const current = p.folderIds || [];
        const hasFolder = current.includes(targetFolderId);
        const shouldHave = checkedSet.has(p.id);
        if (shouldHave && !hasFolder) {
          return { ...p, folderIds: [...current, targetFolderId] };
        }
        if (!shouldHave && hasFolder) {
          return {
            ...p,
            folderIds: current.filter((id) => id !== targetFolderId),
          };
        }
        return p;
      })
    );
    setFolderForPlacesChecklistModal(null);
  };

  const handleToggleSelectSavedId = (placeId: string) => {
    setSelectedSavedIds((prev) =>
      prev.includes(placeId)
        ? prev.filter((id) => id !== placeId)
        : [...prev, placeId]
    );
  };

  // Obliczenie trasy (w widoku zakładek oblicza aktywny dzień, w widoku timeline oblicza wszystkie dni)
  const handleCalculateRoute = async (overrideTimeline?: TripSet['timeline']) => {
    if (!activeSet) return;
    const timelineToUse = overrideTimeline ?? activeSet.timeline;
    const daysToCalculate = deriveDaysFromTimeline(
      timelineToUse,
      activeSet.routesByDay
    );

    setIsCalculatingRoute(true);
    try {
      const nextRoutes: Record<number, NonNullable<typeof activeDerivedDay>['routeInfo'] & object> = {
        ...(activeSet.routesByDay || {}),
      };

      const targetDays =
        dayViewSetting === 'tabs' && !isSetEditMode && activeDerivedDay
          ? [
              daysToCalculate.find(
                (d) => d.dayNumber === activeDerivedDay.dayNumber
              ) || daysToCalculate[0],
            ].filter(Boolean)
          : daysToCalculate;

      for (const d of targetDays) {
        if (d.places.length >= 2) {
          const info = await calculateTripRoute(d.places, travelMode);
          nextRoutes[d.dayNumber] = info;
        }
      }

      setSets((prev) =>
        prev.map((s) =>
          s.id === activeSet.id
            ? {
                ...s,
                timeline: timelineToUse,
                routesByDay: nextRoutes,
              }
            : s
        )
      );
    } finally {
      setIsCalculatingRoute(false);
    }
  };

  // Optymalizacja kolejności 2-opt (wewnątrz aktywnego dnia lub każdego dnia z osobna) + obliczenie trasy
  const handleOptimizeAndCalculateRoute = async () => {
    if (!activeSet) return;
    let nextTimeline = [...activeSet.timeline];

    if (dayViewSetting === 'tabs' && !isSetEditMode && activeDerivedDay) {
      if (activeDerivedDay.places.length < 3) return;
      const optimized = optimizeRoute2Opt(activeDerivedDay.places);
      nextTimeline = replaceDayPlacesInTimeline(
        nextTimeline,
        activeDerivedDay.dayNumber,
        optimized
      );
    } else {
      for (const d of derivedDays) {
        if (d.places.length >= 3) {
          const optimized = optimizeRoute2Opt(d.places);
          nextTimeline = replaceDayPlacesInTimeline(
            nextTimeline,
            d.dayNumber,
            optimized
          );
        }
      }
    }

    await handleCalculateRoute(nextTimeline);
  };

  if (!isWorkspaceReady && !pendingLocalImport) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        {workspaceError ? (
          <div className="max-w-md text-center">
            <p className="text-sm text-rose-200">{workspaceError}</p>
            <button
              type="button"
              onClick={() => {
                setWorkspaceError('');
                setWorkspaceRetry((retry) => retry + 1);
              }}
              className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              Spróbuj ponownie
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
            Ładowanie Twoich danych…
          </div>
        )}
      </main>
    );
  }

  if (pendingLocalImport) {
    const counts = getLegacyDataCounts(pendingLocalImport);
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-5">
        <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
            Pierwsze logowanie na tym urządzeniu
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">
            Przenieść dotychczasowe dane?
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Znaleziono lokalne plany. Import skopiuje je do konta {user.email}; kopia w tej przeglądarce pozostanie zachowana.
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm">
            <div><dt className="text-slate-500">Sety</dt><dd className="font-semibold text-slate-900">{counts.sets}</dd></div>
            <div><dt className="text-slate-500">Miejsca</dt><dd className="font-semibold text-slate-900">{counts.places}</dd></div>
            <div><dt className="text-slate-500">Zapisane</dt><dd className="font-semibold text-slate-900">{counts.savedPlaces}</dd></div>
            <div><dt className="text-slate-500">Foldery</dt><dd className="font-semibold text-slate-900">{counts.folders}</dd></div>
          </dl>
          {workspaceError && <p className="mt-4 text-xs text-rose-600" role="alert">{workspaceError}</p>}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={isImportingLocal}
              onClick={handleImportLocalWorkspace}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {isImportingLocal ? 'Importowanie…' : 'Importuj do mojego konta'}
            </button>
            <button
              type="button"
              disabled={isImportingLocal}
              onClick={handleStartFreshWorkspace}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              Zacznij bez importu
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="flex h-screen bg-slate-900 p-4 text-white">
        Brak VITE_GOOGLE_MAPS_API_KEY w .env
      </div>
    );
  }

  const isSelectedInActiveSet = Boolean(
    selectedPlace && allPlacesInActiveSet.some((p) => p.id === selectedPlace.id)
  );
  const isSelectedInSaved = Boolean(
    selectedPlace && savedPlaces.some((p) => p.id === selectedPlace.id)
  );

  // Filtrowanie zapisanych miejsc po wybranym folderze (jedno miejsce może należeć do wielu folderów)
  const filteredSavedPlaces = savedPlaces.filter((p) => {
    if (activeFolderFilter === 'all') return true;
    return (p.folderIds || []).includes(activeFolderFilter);
  });

  const activeSavedFolder =
    activeFolderFilter !== 'all'
      ? savedFolders.find((f) => f.id === activeFolderFilter) || null
      : null;

  // Wszystkie unikalne miejsca ze wszystkich setów (do widoku ogólnego, gdy żadna zakładka nie jest wybrana)
  const allUniquePlacesFromSets = Array.from(
    new Map(
      sets
        .flatMap((s) =>
          s.timeline
            .filter(
              (e): e is Extract<typeof e, { type: 'place' }> =>
                e.type === 'place'
            )
            .map((e) => [e.place.id, e.place] as const)
        )
    ).values()
  );

  const allSetPlaceIds = new Set(allUniquePlacesFromSets.map((p) => p.id));

  // Zbiór wszystkich ID miejsc dodanych do jakiejkolwiek listy (setów lub Zapisanych),
  // aby po dodaniu miejsca nie wyświetlał się na nim drugi, podglądowy pin
  const allListedPlaceIds = new Set<string>([
    ...allSetPlaceIds,
    ...savedPlaces.map((p) => p.id),
  ]);

  // Gdy set ma podział na dni (lub jesteśmy w podglądzie dnia),
  // wyświetlaj na mapie wszystkie miejsca: z wybranego dnia w normalnym kolorze, a z innych dni wyszarzone.
  const hasMultipleDaysInActiveSet =
    !isSidebarCollapsed &&
    panelView === 'plan' &&
    Boolean(activeSet) &&
    derivedDays.length > 1;

  const isShowingSingleDayTab =
    !isSidebarCollapsed &&
    panelView === 'plan' &&
    Boolean(activeSet) &&
    !isSetEditMode &&
    dayViewSetting === 'tabs';

  // Gdy żadna opcja na Nav Barze nie jest zaznaczona (isSidebarCollapsed === true):
  // - pokazujemy wszystkie miejsca z setów na niebiesko (mapPlaces)
  // - oraz wszystkie miejsca z Zapisanych na pomarańczowo (overviewSavedPlaces)
  const mapPlaces = isSidebarCollapsed
    ? allUniquePlacesFromSets
    : panelView === 'plan' && activeSet
    ? (hasMultipleDaysInActiveSet || isShowingSingleDayTab) && activeDerivedDay
      ? activeDerivedDay.places
      : allPlacesInActiveSet
    : panelView === 'saved'
    ? filteredSavedPlaces
    : panelView === 'recommendations'
    ? recommendedPlaces
    : [];

  const overviewSavedPlaces = isSidebarCollapsed
    ? savedPlaces.filter((p) => !allSetPlaceIds.has(p.id))
    : [];

  const secondaryMapPlaces: SecondaryMapPlace[] =
    !isSidebarCollapsed &&
    panelView === 'plan' &&
    activeSet &&
    activeDerivedDay &&
    derivedDays.length > 1
      ? derivedDays
          .filter((d) => d.dayNumber !== activeDerivedDay.dayNumber)
          .flatMap((d) =>
            d.places.map((place, idx) => ({
              place,
              dayNumber: d.dayNumber,
              indexInDay: idx + 1,
            }))
          )
      : [];

  const activeRoutePath =
    panelView === 'plan' && activeSet
      ? (hasMultipleDaysInActiveSet || isShowingSingleDayTab) && activeDerivedDay
        ? activeDerivedDay.routeInfo?.pathCoords
        : derivedDays.flatMap((d) =>
            d.routeInfo?.pathCoords && d.routeInfo.pathCoords.length >= 2
              ? d.routeInfo.pathCoords
              : d.places.map((p) => ({ lat: p.lat, lng: p.lng }))
          )
      : undefined;

  // Czy przycisk Oblicz trasę / Optymalizuj jest aktywny
  const canCalculateRoute = isShowingSingleDayTab
    ? (activeDerivedDay?.places.length || 0) >= 2
    : derivedDays.some((d) => d.places.length >= 2);

  const canOptimizeRoute = isShowingSingleDayTab
    ? (activeDerivedDay?.places.length || 0) >= 3
    : derivedDays.some((d) => d.places.length >= 3);

  // Karta wybranego miejsca
  const renderSelectedPlaceCard = () => {
    if (!selectedPlace) return null;

    return (
      <div className="relative overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 via-white to-slate-50 shadow-sm">
        {/* Zdjęcie miejsca z Google */}
        {selectedPlace.photoUrl && (
          <div className="relative h-40 w-full bg-slate-100">
            <img
              src={selectedPlace.photoUrl}
              alt={selectedPlace.name}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          </div>
        )}

        <button
          onClick={() => setSelectedPlace(null)}
          className={`absolute right-3 top-3 rounded-full p-1.5 transition-colors ${
            selectedPlace.photoUrl
              ? 'bg-black/50 text-white hover:bg-black/70'
              : 'text-slate-400 hover:bg-slate-200 hover:text-slate-700'
          }`}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-4 space-y-3">
          <div className="pr-7 space-y-1">
            {/* Kategoria oraz Gwiazdki */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                {selectedPlace.category || 'Miejsce'}
              </span>
              <StarRating rating={selectedPlace.rating} />
            </div>

            {/* Nazwa miejsca */}
            <h3 className="text-sm font-bold text-slate-900">
              {selectedPlace.name}
            </h3>

            {/* Adres w swoim dedykowanym miejscu */}
            {selectedPlace.address && (
              <p className="flex items-start gap-1 text-[11px] text-slate-500">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span>{selectedPlace.address}</span>
              </p>
            )}
          </div>

          {/* Pusty, opcjonalny opis / notatka dla użytkownika */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Twoja notatka / opis (opcjonalnie)
            </label>
            <textarea
              rows={2}
              value={selectedPlace.description}
              onChange={(e) =>
                updateSelectedPlaceData((p) => ({
                  ...p,
                  description: e.target.value,
                }))
              }
              placeholder="Wpisz własną notatkę (np. polecenie z TikToka)..."
              className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400"
            />
          </div>

          {/* Tagi miejsca */}
          <div className="space-y-1.5">
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <Tag className="h-3 w-3" /> Tagi
            </span>

            <div className="flex flex-wrap gap-1.5">
              {selectedPlace.tags.map((tag) => (
                <span
                  key={tag}
                  onClick={() => handleToggleTagOnSelected(tag)}
                  title="Kliknij, aby usunąć tag"
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-semibold text-white shadow-sm hover:bg-indigo-700"
                >
                  #{tag}
                  <X className="h-2.5 w-2.5 opacity-80" />
                </span>
              ))}
              {AVAILABLE_CUSTOM_TAGS.filter(
                (t) => !selectedPlace.tags.includes(t)
              )
                .slice(0, 5)
                .map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => handleToggleTagOnSelected(suggestion)}
                    className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
                  >
                    + {suggestion}
                  </button>
                ))}
            </div>

            <form onSubmit={handleAddCustomTag} className="flex gap-1.5 pt-1">
              <input
                type="text"
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.target.value)}
                placeholder="Własny tag..."
                className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-indigo-400"
              />
              <button
                type="submit"
                className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
              >
                Dodaj
              </button>
            </form>
          </div>

          {/* Przyciski akcji: automatyczne dodawanie na sam koniec otwartego setu (lub modal wyboru setu, gdy poza setem) */}
          <div className="flex gap-2 border-t border-slate-200/80 pt-3">
            {activeSet ? (
              <button
                type="button"
                onClick={() =>
                  handleAddPlacesToSetEndAndGo([selectedPlace], activeSet.id)
                }
                disabled={isSelectedInActiveSet}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold shadow-sm transition-all ${
                  isSelectedInActiveSet
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                {isSelectedInActiveSet ? (
                  <>
                    <Check className="h-4 w-4" /> Już w secie
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Dodaj na koniec setu
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openAddToSetModal([selectedPlace])}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700"
              >
                <Plus className="h-4 w-4" /> Dodaj do...
              </button>
            )}

            <button
              type="button"
              onClick={() => handleToggleSavePlace(selectedPlace)}
              title="Zapisz do globalnego zbioru Zapisane"
              className={`flex items-center justify-center gap-1 rounded-xl border px-3 py-2.5 text-xs font-bold transition-all ${
                isSelectedInSaved
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:text-amber-700'
              }`}
            >
              <Bookmark
                className={`h-4 w-4 ${
                  isSelectedInSaved ? 'fill-amber-400' : ''
                }`}
              />
              <span>{isSelectedInSaved ? 'Zapisano' : 'Zapisz'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Karta pojedynczego miejsca w trybie Podglądu (bez przycisków edycji/przesuwania)
  const renderPreviewPlaceItem = (
    place: Place,
    displayIndex: number,
    legAfter?: { distanceText: string; durationText: string },
    dayNumber?: number
  ) => (
    <React.Fragment key={place.id}>
      <li>
        <div
          onClick={() => {
            if (dayNumber) {
              setActiveDayNumber(dayNumber);
            }
            setSelectedPlace(place);
            hasUserChosenMapFocus.current = true;
            setMapFocus({
              lat: place.lat,
              lng: place.lng,
              zoom: 16,
            });
          }}
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-all ${
            selectedPlace?.id === place.id
              ? 'border-indigo-400 bg-indigo-50/50 shadow-sm'
              : 'border-slate-200 bg-white hover:border-indigo-200'
          }`}
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white mt-0.5">
            {displayIndex}
          </div>

          {place.photoUrl && (
            <img
              src={place.photoUrl}
              alt={place.name}
              className="h-12 w-12 shrink-0 rounded-lg object-cover"
            />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {place.category && (
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-indigo-700">
                  {place.category}
                </span>
              )}
              <StarRating rating={place.rating} />
            </div>

            <p className="mt-1 truncate text-xs font-bold text-slate-800">
              {place.name}
            </p>

            {place.address && (
              <p className="mt-0.5 truncate text-[10px] text-slate-400">
                {place.address}
              </p>
            )}

            {place.description && (
              <p className="mt-1 line-clamp-2 text-[11px] italic text-slate-600">
                „{place.description}"
              </p>
            )}

            {place.tags && place.tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {place.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </li>

      {legAfter && (
        <li className="flex items-center gap-2 py-0.5 pl-6 text-[11px] font-medium text-indigo-600">
          <div className="h-4 w-0.5 bg-indigo-300" />
          <ArrowRight className="h-3 w-3" />
          <span>
            {legAfter.distanceText} • {legAfter.durationText}
          </span>
        </li>
      )}
    </React.Fragment>
  );

  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['places']}>
      <div className={`trip-app relative flex h-screen w-screen flex-col overflow-hidden bg-slate-900 font-sans md:flex-row ${theme === 'dark' ? 'trip-theme-dark' : ''}`}>
        {workspaceError && (
          <div className="absolute left-4 right-4 top-4 z-[60] rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 shadow-lg md:left-1/2 md:right-auto md:w-[min(36rem,calc(100%-2rem))] md:-translate-x-1/2" role="alert">
            {workspaceError}
          </div>
        )}
        {/* Kontener Mapy */}
        <div className="relative h-full w-full flex-1">
          <MapComponent
            places={mapPlaces}
            secondaryPlaces={secondaryMapPlaces}
            overviewSavedPlaces={overviewSavedPlaces}
            isOverviewMode={isSidebarCollapsed}
            isRecommendationsMode={
              !isSidebarCollapsed && panelView === 'recommendations'
            }
            allListedPlaceIds={allListedPlaceIds}
            previewPlace={
              !isSidebarCollapsed &&
              (panelView === 'sets' || panelView === 'settings')
                ? null
                : selectedPlace
            }
            selectedPlaceId={
              !isSidebarCollapsed &&
              (panelView === 'sets' || panelView === 'settings')
                ? null
                : selectedPlace?.id
            }
            routePath={isSidebarCollapsed ? undefined : activeRoutePath}
            showRouteLine={
              !isSidebarCollapsed && panelView === 'plan' && Boolean(activeSet)
            }
            mapStyle={mapStyle}
            theme={theme}
            onSelectPlace={(p) => {
              if (isSidebarCollapsed) {
                const ownerSet = sets.find((s) =>
                  s.timeline.some(
                    (e) => e.type === 'place' && e.place.id === p.id
                  )
                );
                if (ownerSet) {
                  setActiveSetId(ownerSet.id);
                  setPanelView('plan');
                } else if (savedPlaces.some((sp) => sp.id === p.id)) {
                  setPanelView('saved');
                }
              }
              handlePlaceInspect(p);
            }}
            onMapPoiClick={(place) => {
              void TripRepository.recordSearch(place.name, 'map', place.id, user.id)
                .catch((error: unknown) => {
                  setWorkspaceError(error instanceof Error ? error.message : 'Nie udało się zapisać historii wyszukiwania.');
                });
              handlePlaceInspect(place);
            }}
            onPlacePhotoLoaded={handlePlacePhotoLoaded}
            onBoundsChanged={(bounds) => {
              currentMapBoundsRef.current = bounds;
            }}
            onUserMovedMap={() => {
              if (!isSidebarCollapsed && panelView === 'recommendations') {
                setIsMapMovedInRecommendations(true);
              }
            }}
            focusLocation={mapFocus}
          />

          {/* Pływający przycisk "Szukaj na widocznej mapie" po przesunięciu mapy w zakładce Polecane */}
          {!isSidebarCollapsed &&
            panelView === 'recommendations' &&
            isMapMovedInRecommendations && (
              <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center px-4">
                <button
                  type="button"
                  onClick={handleSearchOnVisibleMap}
                  disabled={
                    isSearchingRecommendations ||
                    selectedRecCategories.length === 0
                  }
                  className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xl transition-all hover:scale-105 hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>
                    {isSearchingRecommendations
                      ? 'Wyszukiwanie...'
                      : 'Szukaj na widocznej mapie'}
                  </span>
                </button>
              </div>
            )}

          {/* Lewy górny róg: Wyszukiwarka Google i przełącznik stylu mapy */}
          <div className="absolute left-4 right-14 top-4 z-10 flex flex-col gap-2 md:right-auto md:w-96">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setMapStyle('standard')}
                className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold shadow-md transition-all ${
                  mapStyle === 'standard'
                    ? 'bg-white text-indigo-600 ring-2 ring-indigo-500'
                    : 'bg-white/80 text-slate-600 hover:bg-white'
                }`}
              >
                <MapIcon className="h-3.5 w-3.5" /> Mapa
              </button>
              <button
                onClick={() => setMapStyle('satellite')}
                className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold shadow-md transition-all ${
                  mapStyle === 'satellite'
                    ? 'bg-slate-800 text-green-400 ring-2 ring-green-500'
                    : 'bg-white/80 text-slate-600 hover:bg-white'
                }`}
              >
                <Layers className="h-3.5 w-3.5" /> Satelita
              </button>
            </div>
            <PlaceAutocomplete onPlaceSelect={handleAutocompleteSelect} />
          </div>
        </div>

        {/* Panel boczny + pionowy Nav Bar */}
        <aside
          className={`relative z-20 flex flex-col overflow-hidden border-slate-200 bg-white shadow-2xl transition-all duration-300 ease-out md:flex-row ${
            isSidebarCollapsed
              ? 'h-[68px] w-full rounded-t-2xl border-t md:h-full md:w-[76px] md:rounded-none md:border-l md:border-t-0'
              : 'h-[62vh] w-full rounded-t-2xl border-t md:h-full md:w-[32rem] md:rounded-none md:border-l md:border-t-0'
          }`}
        >
          {/* Zawartość otwartego panelu */}
          {!isSidebarCollapsed && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Nagłówek aktualnie otwartej zakładki */}
              <div className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <div
                    className={`rounded-xl p-2 transition-colors ${
                      panelView === 'saved'
                        ? 'bg-amber-50 text-amber-600'
                        : panelView === 'recommendations'
                        ? 'bg-emerald-50 text-emerald-600'
                        : panelView === 'settings'
                        ? 'bg-slate-100 text-slate-700'
                        : 'bg-indigo-50 text-indigo-600'
                    }`}
                  >
                    {panelView === 'saved' ? (
                      <Bookmark className="h-5 w-5 shrink-0" />
                    ) : panelView === 'recommendations' ? (
                      <Sparkles className="h-5 w-5 shrink-0" />
                    ) : panelView === 'settings' ? (
                      <Settings className="h-5 w-5 shrink-0" />
                    ) : (
                      <Compass className="h-5 w-5 shrink-0" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      {panelView === 'saved'
                        ? 'Osobny zbiór miejsc'
                        : panelView === 'recommendations'
                        ? 'Odkrywaj ciekawe miejsca'
                        : panelView === 'settings'
                        ? 'Konfiguracja aplikacji'
                        : panelView === 'sets' || !activeSet
                        ? 'Zarządzanie setami'
                        : isSetEditMode
                        ? 'Edycja osi czasu'
                        : 'Podgląd setu'}
                    </p>
                    <h1 className="truncate text-sm font-bold text-slate-800">
                      {panelView === 'saved'
                        ? `Zapisane (${savedPlaces.length})`
                        : panelView === 'recommendations'
                        ? `Polecane${
                            recommendedPlaces.length > 0
                              ? ` (${recommendedPlaces.length})`
                              : ''
                          }`
                        : panelView === 'settings'
                        ? 'Ustawienia'
                        : panelView === 'sets' || !activeSet
                        ? 'Wybierz lub utwórz set'
                        : activeSet.name}
                    </h1>
                  </div>
                </div>

                {activeSet && panelView === 'plan' && (
                  <button
                    type="button"
                    onClick={handleEnterSetsView}
                    className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>Wszystkie sety</span>
                  </button>
                )}
              </div>

              {/* Edycja nazwy aktywnego setu */}
              {isEditingSetName && activeSet && (
                <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                  <input
                    type="text"
                    value={editedSetName}
                    onChange={(e) => setEditedSetName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveSetName()}
                    placeholder="Nazwa setu..."
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 outline-none focus:border-indigo-500"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveSetName}
                    className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    Zapisz
                  </button>
                  <button
                    onClick={() => setIsEditingSetName(false)}
                    className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-200"
                  >
                    Anuluj
                  </button>
                </div>
              )}

              {/* WIDOK 0: USTAWIENIA */}
              {panelView === 'settings' ? (
                <div className="flex-1 overflow-y-auto bg-slate-50/60 p-4 space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                    <div>
                      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                        Motyw aplikacji
                      </h2>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Wybierz jasny lub ciemny wygląd aplikacji.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        aria-pressed={theme === 'light'}
                        onClick={() => setTheme('light')}
                        className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors ${
                          theme === 'light'
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'
                        }`}
                      >
                        <Sun className="h-4 w-4" /> Jasny
                      </button>
                      <button
                        type="button"
                        aria-pressed={theme === 'dark'}
                        onClick={() => setTheme('dark')}
                        className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors ${
                          theme === 'dark'
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'
                        }`}
                      >
                        <Moon className="h-4 w-4" /> Ciemny
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                    <div>
                      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                        Widok dni w podglądzie wycieczki
                      </h2>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Wybierz, czy w podglądzie setu dni mają wyświetlać się
                        jako zakładki u góry, czy bezpośrednio na jednej osi
                        czasu (Time Line).
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setDayViewSetting('tabs')}
                        className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                          dayViewSetting === 'tabs'
                            ? 'border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-600'
                            : 'border-slate-200 bg-white hover:border-indigo-300'
                        }`}
                      >
                        <Calendar
                          className={`mt-0.5 h-4 w-4 shrink-0 ${
                            dayViewSetting === 'tabs'
                              ? 'text-indigo-600'
                              : 'text-slate-400'
                          }`}
                        />
                        <div>
                          <p className="text-xs font-bold text-slate-900">
                            Zakładki u góry
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Nad listą wyświetlają się przyciski Dzień 1, Dzień
                            2..., które filtrują miejsca dla wybranego dnia.
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDayViewSetting('timeline')}
                        className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                          dayViewSetting === 'timeline'
                            ? 'border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-600'
                            : 'border-slate-200 bg-white hover:border-indigo-300'
                        }`}
                      >
                        <SplitSquareVertical
                          className={`mt-0.5 h-4 w-4 shrink-0 ${
                            dayViewSetting === 'timeline'
                              ? 'text-indigo-600'
                              : 'text-slate-400'
                          }`}
                        />
                        <div>
                          <p className="text-xs font-bold text-slate-900">
                            Na osi czasu (Time Line)
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Wszystkie dni są widoczne jeden pod drugim na
                            wspólnej osi czasu, rozdzielone znacznikami nowego
                            dnia.
                          </p>
                        </div>
                      </button>
                    </div>
                  </div>

                  {activeSetId && (
                    <button
                      type="button"
                      onClick={() => setPanelView('plan')}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700"
                    >
                      Wróć do setu
                    </button>
                  )}
                </div>
              ) : panelView === 'sets' || (!activeSet && panelView === 'plan') ? (
                /* WIDOK 1: ZARZĄDZANIE SETAMI (kompaktowy pasek jak w Zapisanych i folderach) */
                <div className="flex min-h-0 flex-1 flex-col bg-slate-50/60">
                  <div className="border-b border-slate-100 bg-white px-3.5 py-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <FolderOpen className="h-3 w-3" /> Sety ({sets.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsCreatingSet((prev) => !prev)}
                        className="flex items-center gap-1 rounded-lg bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700 transition-colors hover:bg-indigo-100"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Nowy set</span>
                      </button>
                    </div>

                    {isCreatingSet && (
                      <form
                        onSubmit={handleCreateSet}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          type="text"
                          value={newSetName}
                          onChange={(e) => setNewSetName(e.target.value)}
                          placeholder="Nazwa setu (np. Dublin 3 dni)..."
                          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:bg-white"
                          autoFocus
                        />
                        <button
                          type="submit"
                          className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
                        >
                          Utwórz
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsCreatingSet(false);
                            setNewSetName('');
                          }}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </form>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {renderSelectedPlaceCard()}

                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Twoje wycieczki ({sets.length})
                      </span>
                    </div>

                    <ul className="space-y-2">
                      {sets.map((s) => {
                        const sDays = deriveDaysFromTimeline(s.timeline);
                        const totalPlaces = sDays.reduce(
                          (acc, d) => acc + d.places.length,
                          0
                        );
                        return (
                          <li
                            key={s.id}
                            onClick={() => handleSelectExistingSet(s)}
                            className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-sm transition-all hover:border-indigo-300"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-bold text-slate-900">
                                {s.name}
                              </p>
                              <p className="mt-0.5 text-[10px] text-slate-400">
                                {sDays.length}{' '}
                                {sDays.length === 1 ? 'dzień' : 'dni'} •{' '}
                                {totalPlaces} miejsc
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteSet(s.id, e)}
                              title="Usuń set"
                              className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              ) : panelView === 'saved' ? (
                /* WIDOK 2: ZAPISANE MIEJSCA (z folderami, bez "nici" na mapie) */
                <div className="flex min-h-0 flex-1 flex-col bg-slate-50/60">
                  {/* Pasek folderów w Zapisanych (obsługuje też przeciąganie miejsc na foldery) */}
                  <div className="border-b border-slate-100 bg-white px-3.5 py-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <Folder className="h-3 w-3" /> Foldery
                        {draggedSavedPlaceId && (
                          <span className="ml-1 text-[10px] font-semibold normal-case text-amber-600">
                            — upuść miejsce na wybrany folder
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsCreatingFolder((prev) => !prev)}
                        className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700 transition-colors hover:bg-amber-100"
                      >
                        <FolderPlus className="h-3.5 w-3.5" />
                        <span>Nowy folder</span>
                      </button>
                    </div>

                    {isCreatingFolder && (
                      <form
                        onSubmit={handleCreateFolder}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          type="text"
                          value={newFolderName}
                          onChange={(e) => setNewFolderName(e.target.value)}
                          placeholder="Nazwa folderu (np. Kawiarnie, TikTok)..."
                          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-amber-400 focus:bg-white"
                          autoFocus
                        />
                        <button
                          type="submit"
                          className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-amber-600"
                        >
                          Utwórz
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsCreatingFolder(false);
                            setNewFolderName('');
                          }}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </form>
                    )}

                    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveFolderFilter('all');
                          setSelectedSavedIds([]);
                        }}
                        className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
                          activeFolderFilter === 'all'
                            ? 'bg-amber-500 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        <span>Wszystkie</span>
                        <span
                          className={`rounded-full px-1.5 text-[10px] ${
                            activeFolderFilter === 'all'
                              ? 'bg-white/20 text-white'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {savedPlaces.length}
                        </span>
                      </button>

                      {savedFolders.map((folder) => {
                        const isActive = activeFolderFilter === folder.id;
                        const isDragTarget = dragOverFolderId === folder.id;
                        const count = savedPlaces.filter((p) =>
                          (p.folderIds || []).includes(folder.id)
                        ).length;
                        return (
                          <div
                            key={folder.id}
                            onClick={() => {
                              setActiveFolderFilter(folder.id);
                              setSelectedSavedIds([]);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (dragOverFolderId !== folder.id) {
                                setDragOverFolderId(folder.id);
                              }
                            }}
                            onDragLeave={() => {
                              if (dragOverFolderId === folder.id) {
                                setDragOverFolderId(null);
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (draggedSavedPlaceId) {
                                handleDropPlaceOnFolder(
                                  draggedSavedPlaceId,
                                  folder.id
                                );
                              }
                              setDraggedSavedPlaceId(null);
                              setDragOverFolderId(null);
                            }}
                            title="Kliknij, aby otworzyć lub przeciągnij tutaj miejsce"
                            className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-full pl-2.5 pr-1.5 py-1 text-[11px] font-semibold transition-all ${
                              isDragTarget
                                ? 'scale-105 bg-amber-100 text-amber-900 ring-2 ring-amber-500'
                                : isActive
                                ? 'bg-amber-500 text-white shadow-sm'
                                : draggedSavedPlaceId
                                ? 'bg-amber-50/70 text-amber-800 ring-1 ring-dashed ring-amber-400'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            <Folder className="h-3 w-3 shrink-0" />
                            <span className="max-w-[110px] truncate">
                              {folder.name}
                            </span>
                            <span
                              className={`rounded-full px-1.5 text-[10px] ${
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              {count}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteFolder(folder.id, e)}
                              title="Usuń folder"
                              className={`rounded-full p-0.5 transition-colors ${
                                isActive
                                  ? 'text-white/80 hover:bg-white/20 hover:text-white'
                                  : 'text-slate-400 hover:bg-slate-300 hover:text-slate-700'
                              }`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {renderSelectedPlaceCard()}

                    <div className="flex items-center justify-between gap-2 px-1">
                      <span className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {activeSavedFolder
                          ? `${activeSavedFolder.name} (${filteredSavedPlaces.length})`
                          : `Wszystkie zapisane (${filteredSavedPlaces.length})`}
                      </span>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {/* Sposób 3: Po wejściu w folder u góry opcja "Dodaj" -> otwiera listę zapisanych miejsc */}
                        {activeSavedFolder && (
                          <button
                            type="button"
                            onClick={() =>
                              openPlacesChecklistForFolderModal(
                                activeSavedFolder
                              )
                            }
                            className="flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-bold text-white shadow-sm transition-colors hover:bg-amber-600"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Dodaj</span>
                          </button>
                        )}

                        {filteredSavedPlaces.length > 0 && (
                          <>
                            {isSelectModeInSaved && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    selectedSavedIds.length ===
                                    filteredSavedPlaces.length
                                  ) {
                                    setSelectedSavedIds([]);
                                  } else {
                                    setSelectedSavedIds(
                                      filteredSavedPlaces.map((p) => p.id)
                                    );
                                  }
                                }}
                                className="text-[11px] font-semibold text-indigo-600 hover:underline"
                              >
                                {selectedSavedIds.length ===
                                filteredSavedPlaces.length
                                  ? 'Odznacz wszystkie'
                                  : 'Zaznacz wszystkie'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setIsSelectModeInSaved((prev) => !prev);
                                setSelectedSavedIds([]);
                              }}
                              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                                isSelectModeInSaved
                                  ? 'bg-slate-200 text-slate-700'
                                  : 'bg-white text-indigo-600 border border-slate-200 hover:border-indigo-300'
                              }`}
                            >
                              <CheckSquare className="h-3.5 w-3.5" />
                              <span>
                                {isSelectModeInSaved ? 'Anuluj' : 'Zaznaczaj'}
                              </span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {filteredSavedPlaces.length === 0 ? (
                      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                        <Bookmark className="mb-2 h-6 w-6 text-slate-300" />
                        <p className="text-xs font-semibold text-slate-600">
                          {savedPlaces.length === 0
                            ? 'Brak zapisanych miejsc'
                            : 'Brak miejsc w tym folderze'}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {savedPlaces.length === 0
                            ? 'Wyszukaj miejsce u góry i kliknij „Zapisz", aby dodać je do swojego zbioru.'
                            : 'Kliknij przycisk „+ Dodaj" powyżej lub przeciągnij miejsca na ten folder.'}
                        </p>
                        {activeSavedFolder && savedPlaces.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              openPlacesChecklistForFolderModal(
                                activeSavedFolder
                              )
                            }
                            className="mt-3 flex items-center gap-1 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-600"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Dodaj miejsca z listy</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {filteredSavedPlaces.map((place) => {
                          const isChecked = selectedSavedIds.includes(place.id);
                          const isBeingDragged =
                            draggedSavedPlaceId === place.id;
                          const placeFolders = savedFolders.filter((f) =>
                            (place.folderIds || []).includes(f.id)
                          );

                          return (
                            <li
                              key={place.id}
                              draggable={!isSelectModeInSaved}
                              onDragStart={() =>
                                setDraggedSavedPlaceId(place.id)
                              }
                              onDragEnd={() => {
                                setDraggedSavedPlaceId(null);
                                setDragOverFolderId(null);
                              }}
                              onClick={() => {
                                if (isSelectModeInSaved) {
                                  handleToggleSelectSavedId(place.id);
                                } else {
                                  handlePlaceInspect(place);
                                }
                              }}
                              className={`cursor-pointer rounded-2xl border bg-white p-3 shadow-sm transition-all ${
                                isBeingDragged ? 'opacity-40 scale-95' : ''
                              } ${
                                isSelectModeInSaved && isChecked
                                  ? 'border-indigo-500 bg-indigo-50/30 ring-1 ring-indigo-500'
                                  : 'border-slate-200 hover:border-indigo-300'
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                {isSelectModeInSaved ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleSelectSavedId(place.id);
                                    }}
                                    className="shrink-0 text-indigo-600"
                                  >
                                    {isChecked ? (
                                      <CheckSquare className="h-5 w-5 fill-indigo-600 text-white" />
                                    ) : (
                                      <Square className="h-5 w-5 text-slate-300" />
                                    )}
                                  </button>
                                ) : (
                                  <span
                                    title="Przeciągnij na folder u góry"
                                    className="shrink-0 cursor-grab text-slate-300 hover:text-slate-500"
                                  >
                                    <GripVertical className="h-4 w-4" />
                                  </span>
                                )}

                                {place.photoUrl && (
                                  <img
                                    src={place.photoUrl}
                                    alt={place.name}
                                    className="h-12 w-12 shrink-0 rounded-xl object-cover"
                                  />
                                )}

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-indigo-700">
                                      {place.category}
                                    </span>
                                    <StarRating rating={place.rating} />
                                  </div>
                                  <p className="mt-0.5 truncate text-xs font-bold text-slate-900">
                                    {place.name}
                                  </p>
                                  {place.address && (
                                    <p className="truncate text-[10px] text-slate-400">
                                      {place.address}
                                    </p>
                                  )}
                                  {place.description && (
                                    <p className="mt-0.5 truncate text-[10px] italic text-slate-600">
                                      „{place.description}"
                                    </p>
                                  )}

                                  {/* Przypisane foldery jako lekkie plakietki */}
                                  {placeFolders.length > 0 && (
                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                      {placeFolders.map((f) => (
                                        <span
                                          key={f.id}
                                          className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800 border border-amber-200/70"
                                        >
                                          <Folder className="h-2.5 w-2.5 text-amber-500" />
                                          {f.name}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {!isSelectModeInSaved && (
                                  <div
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex shrink-0 items-center gap-1"
                                  >
                                    {/* Sposób 2: Po prawej stronie "+" otwierający modal z checklistą folderów */}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openFolderChecklistModal([place])
                                      }
                                      title="Dodaj do folderów (checklista)"
                                      className="flex items-center gap-0.5 rounded-xl bg-amber-50 px-2 py-1.5 text-[11px] font-bold text-amber-700 transition-colors hover:bg-amber-500 hover:text-white"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                      <Folder className="h-3.5 w-3.5" />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() =>
                                        openAddToSetModal([place])
                                      }
                                      title="Wybierz set, do którego dodać to miejsce"
                                      className="flex items-center gap-1 rounded-xl bg-indigo-50 px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 transition-colors hover:bg-indigo-600 hover:text-white"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                      <span>Set</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleToggleSavePlace(place)
                                      }
                                      title="Usuń z zapisanych"
                                      className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  {isSelectModeInSaved && (
                    <div className="flex gap-2 border-t border-slate-200 bg-white p-3.5">
                      <button
                        type="button"
                        disabled={selectedSavedIds.length === 0}
                        onClick={() => {
                          const selectedObjs = savedPlaces.filter((p) =>
                            selectedSavedIds.includes(p.id)
                          );
                          openFolderChecklistModal(selectedObjs);
                        }}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-40"
                      >
                        <Folder className="h-4 w-4" />
                        <span>
                          Do folderów ({selectedSavedIds.length})
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={selectedSavedIds.length === 0}
                        onClick={() => {
                          const selectedObjs = savedPlaces.filter((p) =>
                            selectedSavedIds.includes(p.id)
                          );
                          openAddToSetModal(selectedObjs);
                        }}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-40"
                      >
                        <Plus className="h-4 w-4" />
                        <span>
                          Dodaj do setu ({selectedSavedIds.length})
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              ) : panelView === 'recommendations' ? (
                /* WIDOK POLECANYCH MIEJSC (wybór regionu + kategorii zainteresowań) */
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50/40">
                  <form
                    onSubmit={handleSearchRecommendations}
                    className="space-y-3 border-b border-slate-100 bg-white p-3.5"
                  >
                    <div>
                      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Region lub miasto (opcjonalnie)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={recRegionQuery}
                          onChange={(e) => setRecRegionQuery(e.target.value)}
                          placeholder="Wpisz miasto/region lub szukaj na mapie..."
                          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={
                            isSearchingRecommendations ||
                            selectedRecCategories.length === 0
                          }
                          className="flex shrink-0 items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <Search className="h-3.5 w-3.5" />
                          <span>
                            {isSearchingRecommendations
                              ? 'Szukam...'
                              : 'Pokaż'}
                          </span>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={handleSearchOnVisibleMap}
                        disabled={
                          isSearchingRecommendations ||
                          selectedRecCategories.length === 0
                        }
                        className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all disabled:opacity-50 ${
                          isMapMovedInRecommendations
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500/20'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-800'
                        }`}
                      >
                        <Compass className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Szukaj na obecnie widocznej mapie</span>
                      </button>
                    </div>

                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          Co Cię interesuje? ({selectedRecCategories.length})
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {RECOMMENDATION_CATEGORIES.map((cat) => {
                          const isChecked = selectedRecCategories.includes(
                            cat.id
                          );
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => handleToggleRecCategory(cat.id)}
                              className={`flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-semibold transition-all ${
                                isChecked
                                  ? 'border-emerald-500 bg-emerald-50 text-emerald-800 shadow-xs'
                                  : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300'
                              }`}
                            >
                              {isChecked && <Check className="h-3 w-3" />}
                              <span>{cat.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </form>

                  <div className="flex-1 overflow-y-auto p-3.5">
                    {isSearchingRecommendations ? (
                      <div className="flex h-full flex-col items-center justify-center py-10 text-center text-slate-400">
                        <Sparkles className="mb-2 h-8 w-8 animate-pulse text-emerald-500" />
                        <p className="text-xs font-medium text-slate-600">
                          {recRegionQuery.trim()
                            ? `Wyszukiwanie polecanych miejsc w „${recRegionQuery}”...`
                            : 'Wyszukiwanie polecanych miejsc na widocznej mapie...'}
                        </p>
                      </div>
                    ) : recommendedPlaces.length === 0 ? (
                      <div className="flex h-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center text-slate-400">
                        <Sparkles className="mb-2 h-9 w-9 stroke-1 text-emerald-500/70" />
                        <p className="text-xs font-medium text-slate-600">
                          {hasSearchedRecommendations
                            ? 'Nie znaleziono miejsc dla wybranych kryteriów w tym obszarze.'
                            : 'Wpisz region i kliknij „Pokaż” lub kliknij „Szukaj na obecnie widocznej mapie”.'}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          Polecane miejsca pojawią się na mapie i tutaj na liście — jednym kliknięciem zapiszesz je lub dodasz do setu.
                        </p>
                      </div>
                    ) : (
                      <ul className="space-y-2.5">
                        {recommendedPlaces.map((place, index) => {
                          const isSelected = selectedPlace?.id === place.id;
                          const isSaved = savedPlaces.some(
                            (sp) => sp.id === place.id
                          );

                          return (
                            <li
                              key={place.id}
                              onClick={() => handlePlaceInspect(place)}
                              className={`group cursor-pointer rounded-2xl border p-3 transition-all ${
                                isSelected
                                  ? 'border-emerald-500 bg-emerald-50/70 shadow-sm'
                                  : 'border-slate-200/80 bg-white hover:border-emerald-300 hover:shadow-sm'
                              }`}
                            >
                              <div className="flex items-start gap-2.5">
                                {place.photoUrl ? (
                                  <img
                                    src={place.photoUrl}
                                    alt={place.name}
                                    className="h-14 w-14 shrink-0 rounded-xl object-cover border border-slate-100"
                                  />
                                ) : (
                                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-xs font-bold text-white">
                                    {index + 1}
                                  </span>
                                )}

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-1.5">
                                    <h3 className="truncate text-sm font-bold text-slate-900">
                                      {index + 1}. {place.name}
                                    </h3>
                                    {typeof place.rating === 'number' && (
                                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-700">
                                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                        {place.rating.toFixed(1)}
                                      </span>
                                    )}
                                  </div>

                                  {place.address && (
                                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                                      {place.address}
                                    </p>
                                  )}

                                  {place.tags.length > 0 && (
                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                      {place.tags.map((tag) => (
                                        <span
                                          key={tag}
                                          className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div
                                className="mt-2.5 flex items-center justify-end gap-1.5 border-t border-slate-100 pt-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleToggleSavePlace(place)}
                                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
                                    isSaved
                                      ? 'bg-amber-500 text-white'
                                      : 'border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                  }`}
                                >
                                  <Bookmark className="h-3 w-3" />
                                  <span>{isSaved ? 'Zapisano' : 'Zapisz'}</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    const existingSaved = savedPlaces.find(
                                      (sp) => sp.id === place.id
                                    );
                                    const placeToUse = existingSaved || {
                                      ...place,
                                      folderIds: [],
                                    };
                                    if (!existingSaved) {
                                      setSavedPlaces((prev) => [
                                        placeToUse,
                                        ...prev,
                                      ]);
                                    }
                                    openFolderChecklistModal([placeToUse]);
                                  }}
                                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-700 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
                                >
                                  <Folder className="h-3 w-3" />
                                  <span>+ Folder</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => openAddToSetModal([place])}
                                  className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-xs transition-colors hover:bg-indigo-700"
                                >
                                  <Plus className="h-3 w-3" />
                                  <span>Do setu</span>
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                /* WIDOK 3: AKTYWNY SET (PODGLĄD LUB TRYB EDYCJI) */
                <>
                  {/* Pasek narzędzi setu: przełącznik Podgląd / Edytuj + w trybie edycji przycisk dodania <br> */}
                  {activeSet && (
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3.5 py-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setIsSetEditMode((prev) => !prev)}
                          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                            isSetEditMode
                              ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
                              : 'bg-white text-slate-700 border border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                          }`}
                        >
                          {isSetEditMode ? (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              <span>Zakończ edycję</span>
                            </>
                          ) : (
                            <>
                              <Edit3 className="h-3.5 w-3.5" />
                              <span>Edytuj kolejność i dni</span>
                            </>
                          )}
                        </button>

                        {!isSetEditMode && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditedSetName(activeSet.name);
                              setIsEditingSetName(true);
                            }}
                            title="Zmień nazwę setu"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {isSetEditMode ? (
                        <button
                          type="button"
                          onClick={handleAddDayBreakToTimeline}
                          title="Wstaw podział na nowy dzień (<br>) na oś czasu"
                          className="flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-bold text-indigo-700 transition-colors hover:bg-indigo-100"
                        >
                          <SplitSquareVertical className="h-3.5 w-3.5" />
                          <span>+ Podział dnia (&lt;br&gt;)</span>
                        </button>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
                          <Eye className="h-3.5 w-3.5" /> Tryb podglądu
                        </span>
                      )}
                    </div>
                  )}

                  {/* Zakładki dni u góry (widoczne tylko w Podglądzie, gdy w ustawieniach wybrano 'tabs') */}
                  {activeSet && !isSetEditMode && dayViewSetting === 'tabs' && (
                    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-100 bg-white px-3.5 py-2">
                      <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      {derivedDays.map((day) => {
                        const isCurrentDay =
                          day.dayNumber === activeDerivedDay?.dayNumber;
                        return (
                          <button
                            key={day.dayNumber}
                            type="button"
                            onClick={() => setActiveDayNumber(day.dayNumber)}
                            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                              isCurrentDay
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-slate-50 text-slate-600 border border-slate-200 hover:border-indigo-300'
                            }`}
                          >
                            <span>{day.label}</span>
                            <span
                              className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                                isCurrentDay
                                  ? 'bg-indigo-500 text-white'
                                  : 'bg-slate-200/70 text-slate-600'
                              }`}
                            >
                              {day.places.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* GŁÓWNA ZAWARTOŚĆ SETU */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {renderSelectedPlaceCard()}

                    {isSetEditMode && activeSet ? (
                      /* TRYB EDYCJI: Pełna oś czasu (miejsca + znaczniki <br> podziału na dni) z przesuwaniem */
                      <div className="space-y-3">
                        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-900">
                          Przesuwaj miejsca oraz podziały dni{' '}
                          <code className="font-bold">&lt;br&gt;</code> między
                          sobą, aby ustawić gdzie kończy się i zaczyna kolejny
                          dzień.
                        </div>

                        {/* Nagłówek startu Dnia 1 */}
                        <div className="flex items-center gap-2 px-1 pt-1">
                          <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                            Start: Dzień 1
                          </span>
                          <div className="h-px flex-1 bg-indigo-100" />
                        </div>

                        {activeSet.timeline.length === 0 ? (
                          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                            <MapPin className="mb-2 h-6 w-6 text-slate-300" />
                            <p className="text-xs font-medium text-slate-500">
                              Oś czasu jest pusta
                            </p>
                            <p className="mt-1 text-[11px] text-slate-400">
                              Dodaj miejsca z wyszukiwarki lub Zapisanych.
                            </p>
                          </div>
                        ) : (
                          <ul className="space-y-2">
                            {(() => {
                              let dayCounter = 1;
                              let placeCounter = 0;

                              return activeSet.timeline.map((entry, idx) => {
                                const isBeingDragged =
                                  draggedTimelineIdx === idx;
                                const isDragTarget =
                                  dragOverTimelineIdx === idx;

                                if (entry.type === 'day_break') {
                                  const endedDay = dayCounter;
                                  dayCounter += 1;
                                  const startedDay = dayCounter;

                                  return (
                                    <li
                                      key={entry.id}
                                      draggable
                                      onDragStart={() =>
                                        setDraggedTimelineIdx(idx)
                                      }
                                      onDragOver={(e) => {
                                        e.preventDefault();
                                        if (dragOverTimelineIdx !== idx) {
                                          setDragOverTimelineIdx(idx);
                                        }
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        if (draggedTimelineIdx !== null) {
                                          handleMoveTimelineEntry(
                                            draggedTimelineIdx,
                                            idx
                                          );
                                        }
                                        setDraggedTimelineIdx(null);
                                        setDragOverTimelineIdx(null);
                                      }}
                                      onDragEnd={() => {
                                        setDraggedTimelineIdx(null);
                                        setDragOverTimelineIdx(null);
                                      }}
                                      className={`transition-all ${
                                        isBeingDragged
                                          ? 'opacity-40 scale-95'
                                          : ''
                                      } ${
                                        isDragTarget
                                          ? 'ring-2 ring-indigo-500 rounded-xl'
                                          : ''
                                      }`}
                                    >
                                      <div className="flex cursor-grab items-center justify-between gap-2 rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/70 px-3 py-2">
                                        <div className="flex items-center gap-2">
                                          <GripVertical className="h-4 w-4 text-indigo-400" />
                                          <SplitSquareVertical className="h-4 w-4 text-indigo-600" />
                                          <div>
                                            <span className="text-[11px] font-bold text-indigo-900">
                                              &lt;br&gt; Koniec Dnia {endedDay}{' '}
                                              → Początek Dnia {startedDay}
                                            </span>
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-0.5">
                                          <button
                                            type="button"
                                            disabled={idx === 0}
                                            onClick={() =>
                                              handleMoveTimelineEntry(
                                                idx,
                                                idx - 1
                                              )
                                            }
                                            title="Przesuń podział wyżej"
                                            className="rounded p-1 text-indigo-500 hover:bg-indigo-100 disabled:opacity-25"
                                          >
                                            <ChevronUp className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            disabled={
                                              idx ===
                                              activeSet.timeline.length - 1
                                            }
                                            onClick={() =>
                                              handleMoveTimelineEntry(
                                                idx,
                                                idx + 1
                                              )
                                            }
                                            title="Przesuń podział niżej"
                                            className="rounded p-1 text-indigo-500 hover:bg-indigo-100 disabled:opacity-25"
                                          >
                                            <ChevronDown className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) =>
                                              handleRemoveTimelineEntry(
                                                entry.id,
                                                e
                                              )
                                            }
                                            title="Usuń podział dnia"
                                            className="ml-1 rounded p-1 text-indigo-400 hover:bg-red-100 hover:text-red-600"
                                          >
                                            <X className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    </li>
                                  );
                                }

                                placeCounter += 1;
                                const place = entry.place;

                                return (
                                  <li
                                    key={entry.id}
                                    draggable
                                    onDragStart={() =>
                                      setDraggedTimelineIdx(idx)
                                    }
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      if (dragOverTimelineIdx !== idx) {
                                        setDragOverTimelineIdx(idx);
                                      }
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      if (draggedTimelineIdx !== null) {
                                        handleMoveTimelineEntry(
                                          draggedTimelineIdx,
                                          idx
                                        );
                                      }
                                      setDraggedTimelineIdx(null);
                                      setDragOverTimelineIdx(null);
                                    }}
                                    onDragEnd={() => {
                                      setDraggedTimelineIdx(null);
                                      setDragOverTimelineIdx(null);
                                    }}
                                    className={`transition-all ${
                                      isBeingDragged
                                        ? 'opacity-40 scale-95'
                                        : ''
                                    } ${
                                      isDragTarget
                                        ? 'ring-2 ring-indigo-500 rounded-xl'
                                        : ''
                                    }`}
                                  >
                                    <div
                                      onClick={() => {
                                        setSelectedPlace(place);
                                        hasUserChosenMapFocus.current = true;
                                        setMapFocus({
                                          lat: place.lat,
                                          lng: place.lng,
                                          zoom: 16,
                                        });
                                      }}
                                      className="group flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-2.5 text-left hover:border-indigo-300"
                                    >
                                      <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-300 group-hover:text-slate-500" />
                                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
                                        {placeCounter}
                                      </div>

                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-xs font-bold text-slate-800">
                                          {place.name}
                                        </p>
                                        <p className="text-[10px] text-slate-400">
                                          Dzień {dayCounter}
                                          {place.address
                                            ? ` • ${place.address}`
                                            : ''}
                                        </p>
                                      </div>

                                      <div
                                        onClick={(e) => e.stopPropagation()}
                                        className="flex items-center gap-0.5"
                                      >
                                        <button
                                          type="button"
                                          disabled={idx === 0}
                                          onClick={() =>
                                            handleMoveTimelineEntry(
                                              idx,
                                              idx - 1
                                            )
                                          }
                                          title="Przesuń wyżej"
                                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25"
                                        >
                                          <ChevronUp className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          disabled={
                                            idx ===
                                            activeSet.timeline.length - 1
                                          }
                                          onClick={() =>
                                            handleMoveTimelineEntry(
                                              idx,
                                              idx + 1
                                            )
                                          }
                                          title="Przesuń niżej"
                                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25"
                                        >
                                          <ChevronDown className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) =>
                                            handleRemoveTimelineEntry(
                                              entry.id,
                                              e
                                            )
                                          }
                                          title="Usuń z setu"
                                          className="ml-0.5 rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  </li>
                                );
                              });
                            })()}
                          </ul>
                        )}
                      </div>
                    ) : dayViewSetting === 'tabs' ? (
                      /* TRYB PODGLĄDU Z ZAKŁADKAMI U GÓRY */
                      <div className="space-y-3">
                        {activeDerivedDay?.routeInfo &&
                          activeDerivedDay.places.length >= 2 && (
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-900">
                                  <Route className="h-4 w-4 text-emerald-600" />
                                  Obliczona trasa ({activeDerivedDay.label})
                                </span>
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                  {activeDerivedDay.routeInfo.mode === 'WALKING'
                                    ? 'Pieszo'
                                    : 'Samochodem'}
                                </span>
                              </div>
                              <div className="flex items-center gap-4 text-xs text-emerald-800">
                                <div>
                                  Dystans:{' '}
                                  <strong className="font-bold">
                                    {
                                      activeDerivedDay.routeInfo
                                        .totalDistanceText
                                    }
                                  </strong>
                                </div>
                                <div>
                                  Czas:{' '}
                                  <strong className="font-bold">
                                    {
                                      activeDerivedDay.routeInfo
                                        .totalDurationText
                                    }
                                  </strong>
                                </div>
                              </div>
                            </div>
                          )}

                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            {activeDerivedDay?.label}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                            {activeDerivedDay?.places.length || 0} miejsc
                          </span>
                        </div>

                        {!activeDerivedDay ||
                        activeDerivedDay.places.length === 0 ? (
                          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                            <MapPin className="mb-2 h-6 w-6 text-slate-300" />
                            <p className="text-xs font-medium text-slate-500">
                              Brak miejsc w {activeDerivedDay?.label}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-400">
                              Nowo dodane miejsca trafiają automatycznie na sam
                              koniec setu. Kliknij „Edytuj kolejność i dni", aby
                              przesuwać elementy.
                            </p>
                          </div>
                        ) : (
                          <ul className="space-y-2">
                            {activeDerivedDay.places.map((place, idx) =>
                              renderPreviewPlaceItem(
                                place,
                                idx + 1,
                                activeDerivedDay.routeInfo?.legs[idx]
                              )
                            )}
                          </ul>
                        )}
                      </div>
                    ) : (
                      /* TRYB PODGLĄDU Z DNIAMI NA OSI CZASU (TIMELINE) */
                      <div className="space-y-5">
                        {derivedDays.map((day) => {
                          const isCurrentDay =
                            day.dayNumber === activeDerivedDay?.dayNumber;
                          return (
                            <div key={day.dayNumber} className="space-y-2.5">
                              {/* Nagłówek / podział dnia na osi czasu (kliknięcie podświetla dany dzień na mapie) */}
                              <div
                                onClick={() => setActiveDayNumber(day.dayNumber)}
                                className="flex cursor-pointer items-center justify-between border-b border-indigo-100 pb-1.5"
                              >
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`rounded-lg px-2.5 py-1 text-xs font-bold shadow-sm transition-colors ${
                                      isCurrentDay
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-slate-200 text-slate-700 hover:bg-indigo-100 hover:text-indigo-700'
                                    }`}
                                  >
                                    {day.label}
                                  </span>
                                  {day.routeInfo && day.places.length >= 2 && (
                                    <span className="text-[11px] font-semibold text-emerald-700">
                                      {day.routeInfo.totalDistanceText} •{' '}
                                      {day.routeInfo.totalDurationText}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] font-bold text-slate-400">
                                  {day.places.length} miejsc
                                </span>
                              </div>

                              {day.places.length === 0 ? (
                                <p className="py-2 text-center text-[11px] italic text-slate-400">
                                  Brak miejsc w tym dniu
                                </p>
                              ) : (
                                <ul className="space-y-2">
                                  {day.places.map((place, idx) =>
                                    renderPreviewPlaceItem(
                                      place,
                                      idx + 1,
                                      day.routeInfo?.legs[idx],
                                      day.dayNumber
                                    )
                                  )}
                                </ul>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* STOPKA PANELU: Tryb podróży, Oblicz trasę i Optymalizacja kolejności */}
                  <div className="border-t border-slate-100 bg-slate-50 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-500">
                        Środek transportu:
                      </span>
                      <div className="flex rounded-xl bg-slate-200/80 p-0.5">
                        <button
                          type="button"
                          onClick={() => setTravelMode('WALKING')}
                          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                            travelMode === 'WALKING'
                              ? 'bg-white text-indigo-600 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Footprints className="h-3.5 w-3.5" /> Pieszo
                        </button>
                        <button
                          type="button"
                          onClick={() => setTravelMode('DRIVING')}
                          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                            travelMode === 'DRIVING'
                              ? 'bg-white text-indigo-600 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Car className="h-3.5 w-3.5" /> Auto
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={!canCalculateRoute || isCalculatingRoute}
                        onClick={() => handleCalculateRoute()}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-40"
                      >
                        <Route className="h-4 w-4" />
                        {isCalculatingRoute ? 'Obliczanie...' : 'Oblicz trasę'}
                      </button>

                      <button
                        type="button"
                        disabled={!canOptimizeRoute || isCalculatingRoute}
                        onClick={handleOptimizeAndCalculateRoute}
                        title="Ułóż optymalną kolejność zwiedzania algorytmem 2-opt i oblicz trasę"
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-xs font-bold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-40"
                      >
                        <Layers className="h-4 w-4" /> Optymalizuj (2-opt)
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* PIONOWY NAV BAR: u góry 1 zakładka do Setów i 1 do Zapisanych, a na samym dole osobna zakładka Ustawień */}
          <nav className="flex shrink-0 items-center justify-between border-t border-slate-100 bg-slate-50/90 px-3 py-2 md:h-full md:w-[76px] md:flex-col md:border-l md:border-t-0 md:px-2 md:py-3">
            {/* GÓRA NAV BARU: 1 zakładka Sety + 1 zakładka Zapisane */}
            <div className="flex items-center gap-2 md:w-full md:flex-col">
              <button
                type="button"
                onClick={handleEnterSetsView}
                title="Sety wycieczek"
                className={`flex flex-col items-center justify-center gap-1 rounded-2xl px-2.5 py-2 text-[10px] font-bold transition-all md:w-full ${
                  !isSidebarCollapsed &&
                  (panelView === 'sets' || panelView === 'plan')
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'
                }`}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span>Sety</span>
              </button>

              <button
                type="button"
                onClick={handleEnterSavedView}
                title="Zapisane miejsca"
                className={`flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-bold transition-all md:w-full ${
                  !isSidebarCollapsed && panelView === 'saved'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-amber-50 hover:text-amber-700'
                }`}
              >
                <Bookmark className="h-4 w-4 shrink-0" />
                <span>Zapisane</span>
              </button>

              <button
                type="button"
                onClick={handleEnterRecommendationsView}
                title="Polecane miejsca"
                className={`flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-bold transition-all md:w-full ${
                  !isSidebarCollapsed && panelView === 'recommendations'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'
                }`}
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                <span>Polecane</span>
              </button>
            </div>

            {/* DÓŁ NAV BARU: Osobna zakładka Ustawienia */}
            <div className="flex items-center gap-2 md:mt-auto md:w-full md:flex-col md:border-t md:border-slate-200/80 md:pt-3">
              <button
                type="button"
                onClick={handleEnterSettingsView}
                title="Ustawienia"
                className={`flex flex-col items-center justify-center gap-1 rounded-2xl px-1.5 py-2 text-[10px] font-bold transition-all md:w-full ${
                  !isSidebarCollapsed && panelView === 'settings'
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-200/80 hover:text-slate-900'
                }`}
              >
                <Settings className="h-4 w-4 shrink-0" />
                <span>Ustawienia</span>
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                title={`Wyloguj (${user.email})`}
                aria-label="Wyloguj"
                className="flex flex-col items-center justify-center gap-1 rounded-2xl px-1.5 py-2 text-[10px] font-bold text-slate-600 transition-all hover:bg-slate-200/80 hover:text-red-600 md:w-full"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span>Wyloguj</span>
              </button>
            </div>
          </nav>
        </aside>

        {/* MODAL WYBORU SETU (dodaje miejsca automatycznie na sam koniec wybranego setu) */}
        {placesForModal && placesForModal.length > 0 && (
          <div
            onClick={() => setPlacesForModal(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Wybierz set, do którego dodać
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {placesForModal.length === 1
                      ? `Miejsce „${placesForModal[0].name}” zostanie dodane na koniec wybranego setu.`
                      : `Wybrano ${placesForModal.length} miejsc (trafią na koniec setu).`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPlacesForModal(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                {sets.map((s) => {
                  const isSelectedSet = s.id === modalTargetSet?.id;
                  const sDays = deriveDaysFromTimeline(s.timeline);
                  const count = sDays.reduce(
                    (acc, d) => acc + d.places.length,
                    0
                  );
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setModalSetId(s.id)}
                      className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-xs transition-all ${
                        isSelectedSet
                          ? 'border-indigo-500 bg-indigo-50/60 font-bold text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'
                      }`}
                    >
                      <span className="truncate">{s.name}</span>
                      <span className="text-[10px] font-normal text-slate-400">
                        {sDays.length} {sDays.length === 1 ? 'dzień' : 'dni'} •{' '}
                        {count} miejsc
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setPlacesForModal(null)}
                  className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Anuluj
                </button>
                {modalTargetSet && (
                  <button
                    type="button"
                    onClick={() =>
                      handleAddPlacesToSetEndAndGo(
                        placesForModal,
                        modalTargetSet.id
                      )
                    }
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700"
                  >
                    <Check className="h-4 w-4" />
                    <span>Dodaj do {modalTargetSet.name}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {/* MODAL SPOSÓB 2: Po prawej stronie "+" -> Checklista folderów (miejsce może być w wielu folderach) */}
        {placesForFolderChecklistModal &&
          placesForFolderChecklistModal.length > 0 && (
            <div
              onClick={() => setPlacesForFolderChecklistModal(null)}
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Wybierz foldery (checklista)
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {placesForFolderChecklistModal.length === 1
                        ? `Zaznacz foldery, w których ma się znaleźć „${placesForFolderChecklistModal[0].name}”.`
                        : `Zaznacz foldery dla ${placesForFolderChecklistModal.length} wybranych miejsc.`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPlacesForFolderChecklistModal(null)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Szybkie utworzenie nowego folderu bezpośrednio w modalu */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const trimmed =
                      newFolderName.trim() ||
                      `Folder #${savedFolders.length + 1}`;
                    const created = createNewSavedFolder(trimmed);
                    setSavedFolders((prev) => [...prev, created]);
                    setCheckedFolderIdsInModal((prev) => [...prev, created.id]);
                    setNewFolderName('');
                  }}
                  className="flex gap-1.5"
                >
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Utwórz nowy folder..."
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-amber-400 focus:bg-white"
                  />
                  <button
                    type="submit"
                    className="flex shrink-0 items-center gap-1 rounded-xl bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-200"
                  >
                    <Plus className="h-3.5 w-3.5" /> Dodaj
                  </button>
                </form>

                {savedFolders.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-400">
                    Nie masz jeszcze żadnych folderów. Wpisz nazwę powyżej i
                    kliknij „Dodaj".
                  </p>
                ) : (
                  <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                    {savedFolders.map((f) => {
                      const isChecked = checkedFolderIdsInModal.includes(f.id);
                      const count = savedPlaces.filter((p) =>
                        (p.folderIds || []).includes(f.id)
                      ).length;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => handleToggleFolderInChecklistModal(f.id)}
                          className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-xs transition-all ${
                            isChecked
                              ? 'border-amber-500 bg-amber-50/70 font-bold text-amber-900'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-amber-300'
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            {isChecked ? (
                              <CheckSquare className="h-4 w-4 shrink-0 fill-amber-500 text-white" />
                            ) : (
                              <Square className="h-4 w-4 shrink-0 text-slate-300" />
                            )}
                            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                            <span className="truncate">{f.name}</span>
                          </span>
                          <span className="text-[10px] font-normal text-slate-400">
                            {count} miejsc
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="flex gap-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setPlacesForFolderChecklistModal(null)}
                    className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    Anuluj
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveFolderChecklistModal}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-amber-600"
                  >
                    <Check className="h-4 w-4" />
                    <span>Zapisz foldery</span>
                  </button>
                </div>
              </div>
            </div>
          )}

        {/* MODAL SPOSÓB 3: Po wejściu w folder u góry opcja "Dodaj" -> Checklista zapisanych miejsc */}
        {folderForPlacesChecklistModal && (
          <div
            onClick={() => setFolderForPlacesChecklistModal(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Dodaj miejsca do folderu „{folderForPlacesChecklistModal.name}”
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Zaznacz z listy Zapisanych miejsca, które mają należeć do tego
                    folderu.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFolderForPlacesChecklistModal(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {savedPlaces.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">
                  Brak zapisanych miejsc do dodania.
                </p>
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {savedPlaces.map((p) => {
                    const isChecked = checkedPlaceIdsInFolderModal.includes(
                      p.id
                    );
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          handleTogglePlaceInFolderChecklistModal(p.id)
                        }
                        className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-xs transition-all ${
                          isChecked
                            ? 'border-amber-500 bg-amber-50/70 font-bold text-amber-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-amber-300'
                        }`}
                      >
                        {isChecked ? (
                          <CheckSquare className="h-4 w-4 shrink-0 fill-amber-500 text-white" />
                        ) : (
                          <Square className="h-4 w-4 shrink-0 text-slate-300" />
                        )}
                        {p.photoUrl && (
                          <img
                            src={p.photoUrl}
                            alt={p.name}
                            className="h-8 w-8 shrink-0 rounded-lg object-cover"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold">{p.name}</p>
                          {p.address && (
                            <p className="truncate text-[10px] font-normal text-slate-400">
                              {p.address}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setFolderForPlacesChecklistModal(null)}
                  className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  onClick={handleSavePlacesChecklistForFolderModal}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-amber-600"
                >
                  <Check className="h-4 w-4" />
                  <span>
                    Zapisz ({checkedPlaceIdsInFolderModal.length})
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </APIProvider>
  );
}

export default function App() {
  return (
    <AuthGate>
      <TripPlannerApp />
    </AuthGate>
  );
}
