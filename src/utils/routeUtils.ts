import type {
  DerivedDay,
  Place,
  RouteInfo,
  RouteLegInfo,
  SavedFolder,
  TimelineEntry,
  TravelModeOption,
  TripSet,
} from '../types/trip';

let entryCounter = 0;

export function createNewSavedFolder(name: string): SavedFolder {
  entryCounter += 1;
  const now = Date.now();
  return {
    id: `folder-${now}-${entryCounter}`,
    name,
    createdAt: now,
  };
}

export function createDayBreakEntry(): TimelineEntry {
  entryCounter += 1;
  return {
    type: 'day_break',
    id: `br-${Date.now()}-${entryCounter}`,
  };
}

export function createPlaceEntry(place: Place): TimelineEntry {
  entryCounter += 1;
  return {
    type: 'place',
    id: `item-${place.id}-${Date.now()}-${entryCounter}`,
    place,
  };
}

export function createNewTripSet(name: string): TripSet {
  const now = Date.now();
  return {
    id: `set-${now}`,
    name,
    createdAt: now,
    timeline: [],
    routesByDay: {},
  };
}

/**
 * Migruje starsze sety z polami `days` do nowego formatu `timeline` z podziałami `<br>` (`day_break`).
 */
export function normalizeTripSet(raw: TripSet): TripSet {
  if (Array.isArray(raw.timeline)) {
    return {
      ...raw,
      routesByDay: raw.routesByDay || {},
    };
  }

  const timeline: TimelineEntry[] = [];
  const legacyDays = raw.days || [];
  legacyDays.forEach((day, dayIdx) => {
    if (dayIdx > 0) {
      timeline.push({
        type: 'day_break',
        id: `br-migrated-${raw.id}-${dayIdx}`,
      });
    }
    (day.places || []).forEach((p, pIdx) => {
      timeline.push({
        type: 'place',
        id: `item-migrated-${raw.id}-${dayIdx}-${pIdx}-${p.id}`,
        place: p,
      });
    });
  });

  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    createdAt: raw.createdAt || Date.now(),
    timeline,
    routesByDay: raw.routesByDay || {},
  };
}

/**
 * Wylicza strukturę dni na podstawie osi czasu (`timeline`) oraz znaczników `<br>` (`day_break`).
 */
export function deriveDaysFromTimeline(
  timeline: TimelineEntry[],
  routesByDay?: Record<number, RouteInfo>
): DerivedDay[] {
  const days: DerivedDay[] = [
    {
      dayNumber: 1,
      label: 'Dzień 1',
      places: [],
      routeInfo: routesByDay?.[1] || null,
    },
  ];

  for (const entry of timeline) {
    if (entry.type === 'day_break') {
      const nextDayNum = days.length + 1;
      days.push({
        dayNumber: nextDayNum,
        label: `Dzień ${nextDayNum}`,
        breakEntryId: entry.id,
        places: [],
        routeInfo: routesByDay?.[nextDayNum] || null,
      });
    } else {
      days[days.length - 1].places.push(entry.place);
    }
  }

  return days;
}

const GOOGLE_TYPE_TO_POLISH_TAG: Record<string, string> = {
  tourist_attraction: 'Atrakcja',
  museum: 'Muzeum',
  art_gallery: 'Galeria sztuki',
  church: 'Świątynia',
  place_of_worship: 'Świątynia',
  synagogue: 'Synagoga',
  mosque: 'Meczet',
  park: 'Park',
  natural_feature: 'Natura',
  zoo: 'Zoo',
  aquarium: 'Akwarium',
  amusement_park: 'Park rozrywki',
  restaurant: 'Restauracja',
  food: 'Jedzenie',
  cafe: 'Kawiarnia',
  bakery: 'Piekarnia',
  bar: 'Bar',
  night_club: 'Życie nocne',
  lodging: 'Nocleg',
  shopping_mall: 'Zakupy',
  store: 'Sklep',
  book_store: 'Księgarnia',
  clothing_store: 'Sklep',
  stadium: 'Stadion',
  spa: 'Spa & Relaks',
  transit_station: 'Transport',
  train_station: 'Stacja kolejowa',
  Subway_station: 'Metro',
  airport: 'Lotnisko',
  university: 'Uczelnia',
  library: 'Biblioteka',
  city_hall: 'Ratusz',
  Bridge: 'Most',
  point_of_interest: 'Ciekawe miejsce',
  establishment: 'Obiekt',
  locality: 'Miejscowość',
};

export const AVAILABLE_CUSTOM_TAGS = [
  'TikTok',
  'Must-see',
  'Jedzenie',
  'Kawiarnia',
  'Atrakcja',
  'Zabytek',
  'Punkt widokowy',
  'Muzeum',
  'Park',
  'Nocleg',
  'Zakupy',
];

export function extractPolishTags(types?: string[]): string[] {
  if (!types || types.length === 0) return ['Miejsce'];
  const tags: string[] = [];
  for (const t of types) {
    const mapped = GOOGLE_TYPE_TO_POLISH_TAG[t];
    if (mapped && !tags.includes(mapped)) {
      tags.push(mapped);
    }
  }
  const specific = tags.filter((t) => t !== 'Obiekt' && t !== 'Ciekawe miejsce');
  if (specific.length > 0) {
    return specific.slice(0, 3);
  }
  return tags.length > 0 ? tags.slice(0, 1) : ['Miejsce'];
}

export function haversineDistanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000; // promień Ziemi w metrach
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours} godz. ${mins} min` : `${hours} godz.`;
}

/**
 * Algorytm Nearest Neighbor + 2-opt do ułożenia optymalnej kolejności zwiedzania.
 * Zachowuje pierwszy punkt jako punkt początkowy trasy dnia.
 */
export function optimizeRoute2Opt(places: Place[]): Place[] {
  if (places.length <= 2) return [...places];

  // Krok 1: Nearest Neighbor z pierwszego miejsca jako punktu startowego
  const unvisited = places.slice(1);
  const route: Place[] = [places[0]];

  while (unvisited.length > 0) {
    const current = route[route.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const d = haversineDistanceMeters(current, unvisited[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    route.push(unvisited.splice(bestIdx, 1)[0]);
  }

  // Krok 2: Lokalna optymalizacja 2-opt (usuwanie przecięć trasy)
  const n = route.length;
  let improved = true;
  let iterations = 0;

  const routeDistance = (arr: Place[]) => {
    let total = 0;
    for (let i = 0; i < arr.length - 1; i++) {
      total += haversineDistanceMeters(arr[i], arr[i + 1]);
    }
    return total;
  };

  while (improved && iterations < 100) {
    improved = false;
    iterations++;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const newRoute = [
          ...route.slice(0, i),
          ...route.slice(i, k + 1).reverse(),
          ...route.slice(k + 1),
        ];
        if (routeDistance(newRoute) + 0.01 < routeDistance(route)) {
          route.splice(0, route.length, ...newRoute);
          improved = true;
        }
      }
    }
  }

  return route;
}

/**
 * Podmienia miejsca wewnątrz wskazanego dnia (np. po optymalizacji 2-opt) w osi czasu `timeline`.
 */
export function replaceDayPlacesInTimeline(
  timeline: TimelineEntry[],
  targetDayNumber: number,
  newPlaces: Place[]
): TimelineEntry[] {
  const result: TimelineEntry[] = [];
  let currentDay = 1;
  let insertedForTarget = false;

  for (const entry of timeline) {
    if (entry.type === 'day_break') {
      if (currentDay === targetDayNumber && !insertedForTarget) {
        newPlaces.forEach((p) => result.push(createPlaceEntry(p)));
        insertedForTarget = true;
      }
      result.push(entry);
      currentDay += 1;
    } else if (currentDay !== targetDayNumber) {
      result.push(entry);
    } else if (!insertedForTarget) {
      newPlaces.forEach((p) => result.push(createPlaceEntry(p)));
      insertedForTarget = true;
    }
  }

  if (currentDay === targetDayNumber && !insertedForTarget) {
    newPlaces.forEach((p) => result.push(createPlaceEntry(p)));
  }

  return result;
}

/**
 * Obliczenie szacunkowej trasy (gdy Google Directions API nie jest włączone na kluczu lub jako natychmiastowy fallback)
 */
export function calculateFallbackRoute(places: Place[], mode: TravelModeOption): RouteInfo {
  const legs: RouteLegInfo[] = [];
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;

  // Współczynnik krętości dróg miejskich (~1.28x linii prostej)
  const roadFactor = 1.28;
  // Prędkość: pieszo ~4.6 km/h (1.28 m/s), autem w mieście ~32 km/h (8.9 m/s)
  const speedMetersPerSec = mode === 'WALKING' ? 1.28 : 8.9;

  for (let i = 0; i < places.length - 1; i++) {
    const from = places[i];
    const to = places[i + 1];
    const straightDist = haversineDistanceMeters(from, to);
    const estDist = Math.round(straightDist * roadFactor);
    const estSec = Math.max(60, Math.round(estDist / speedMetersPerSec));

    totalDistanceMeters += estDist;
    totalDurationSeconds += estSec;

    legs.push({
      fromId: from.id,
      toId: to.id,
      fromName: from.name,
      toName: to.name,
      distanceMeters: estDist,
      durationSeconds: estSec,
      distanceText: formatDistance(estDist),
      durationText: formatDuration(estSec),
    });
  }

  return {
    totalDistanceMeters,
    totalDurationSeconds,
    totalDistanceText: formatDistance(totalDistanceMeters),
    totalDurationText: formatDuration(totalDurationSeconds),
    legs,
    pathCoords: places.map((p) => ({ lat: p.lat, lng: p.lng })),
    mode,
    isFallbackEstimate: true,
  };
}

/**
 * Oblicza dokładną trasę przy użyciu Google Maps DirectionsService,
 * a w razie błędu/braku uprawnień API bezpiecznie wraca do estymacji drogowej.
 */
export async function calculateTripRoute(
  places: Place[],
  mode: TravelModeOption
): Promise<RouteInfo> {
  if (places.length < 2) {
    return {
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      totalDistanceText: '0 m',
      totalDurationText: '0 min',
      legs: [],
      pathCoords: places.map((p) => ({ lat: p.lat, lng: p.lng })),
      mode,
    };
  }

  if (typeof google === 'undefined' || !google.maps?.DirectionsService || places.length > 25) {
    return calculateFallbackRoute(places, mode);
  }

  try {
    const directionsService = new google.maps.DirectionsService();
    const origin = { lat: places[0].lat, lng: places[0].lng };
    const destination = {
      lat: places[places.length - 1].lat,
      lng: places[places.length - 1].lng,
    };
    const waypoints: google.maps.DirectionsWaypoint[] = places
      .slice(1, -1)
      .map((p) => ({
        location: { lat: p.lat, lng: p.lng },
        stopover: true,
      }));

    const result = await directionsService.route({
      origin,
      destination,
      waypoints,
      travelMode:
        mode === 'WALKING' ? google.maps.TravelMode.WALKING : google.maps.TravelMode.DRIVING,
    });

    const primaryRoute = result.routes?.[0];
    if (!primaryRoute || !primaryRoute.legs) {
      return calculateFallbackRoute(places, mode);
    }

    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;
    const legs: RouteLegInfo[] = [];

    primaryRoute.legs.forEach((leg, idx) => {
      const from = places[idx];
      const to = places[idx + 1];
      const dist = leg.distance?.value ?? 0;
      const dur = leg.duration?.value ?? 0;
      totalDistanceMeters += dist;
      totalDurationSeconds += dur;

      legs.push({
        fromId: from?.id ?? String(idx),
        toId: to?.id ?? String(idx + 1),
        fromName: from?.name ?? leg.start_address,
        toName: to?.name ?? leg.end_address,
        distanceMeters: dist,
        durationSeconds: dur,
        distanceText: leg.distance?.text || formatDistance(dist),
        durationText: leg.duration?.text || formatDuration(dur),
      });
    });

    const pathCoords = primaryRoute.overview_path
      ? primaryRoute.overview_path.map((latLng) => ({
          lat: latLng.lat(),
          lng: latLng.lng(),
        }))
      : places.map((p) => ({ lat: p.lat, lng: p.lng }));

    return {
      totalDistanceMeters,
      totalDurationSeconds,
      totalDistanceText: formatDistance(totalDistanceMeters),
      totalDurationText: formatDuration(totalDurationSeconds),
      legs,
      pathCoords,
      mode,
      isFallbackEstimate: false,
    };
  } catch {
    return calculateFallbackRoute(places, mode);
  }
}
