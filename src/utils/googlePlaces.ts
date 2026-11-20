import type { Place } from '../types/trip';
import { extractPolishTags } from './routeUtils';

export interface GooglePredictionItem {
  placeId: string;
  mainText: string;
  secondaryText: string;
  types: string[];
}

export interface ResolvedGooglePlace {
  place: Place;
  isCityOrRegion: boolean;
  recommendedZoom: number;
}

const REGION_TYPES = new Set([
  'locality',
  'sublocality',
  'postal_town',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'country',
  'continent',
  'colloquial_area',
]);

const POI_TYPES = new Set([
  'point_of_interest',
  'establishment',
  'tourist_attraction',
  'museum',
  'restaurant',
  'cafe',
  'bar',
  'lodging',
  'park',
  'church',
  'place_of_worship',
  'art_gallery',
  'zoo',
  'aquarium',
  'amusement_park',
  'shopping_mall',
  'store',
  'stadium',
  'airport',
  'train_station',
  'transit_station',
]);

export function isRegionOrCityTypes(types?: string[]): boolean {
  if (!types || types.length === 0) return false;
  const hasRegion = types.some((t) => REGION_TYPES.has(t));
  const hasPoi = types.some((t) => POI_TYPES.has(t));
  return hasRegion && !hasPoi;
}

export function getRecommendedZoomForTypes(types?: string[]): number {
  if (!types) return 15;
  if (types.includes('country')) return 6;
  if (types.includes('administrative_area_level_1')) return 9;
  if (isRegionOrCityTypes(types)) return 13;
  return 16;
}

/**
 * Pobiera podpowiedzi autouzupełniania w 100% z Google Maps Places API.
 */
export async function fetchGoogleAutocompletePredictions(
  input: string,
  placesLib: google.maps.PlacesLibrary | null,
  map?: google.maps.Map | null
): Promise<GooglePredictionItem[]> {
  const trimmed = input.trim();
  if (trimmed.length < 2 || typeof google === 'undefined') return [];

  // 1. Klasyczne Google AutocompleteService
  if (placesLib?.AutocompleteService) {
    try {
      const service = new placesLib.AutocompleteService();
      const bounds = map?.getBounds() ?? undefined;
      const response = await new Promise<google.maps.places.AutocompletePrediction[]>(
        (resolve, reject) => {
          service.getPlacePredictions(
            {
              input: trimmed,
              bounds,
            },
            (predictions, status) => {
              if (
                status === placesLib.PlacesServiceStatus.OK &&
                predictions &&
                predictions.length > 0
              ) {
                resolve(predictions);
              } else if (status === placesLib.PlacesServiceStatus.ZERO_RESULTS) {
                resolve([]);
              } else {
                reject(new Error(status));
              }
            }
          );
        }
      );

      return response.slice(0, 7).map((p) => ({
        placeId: p.place_id,
        mainText: p.structured_formatting?.main_text || p.description,
        secondaryText: p.structured_formatting?.secondary_text || '',
        types: p.types || [],
      }));
    } catch {
      // Przejdź do kolejnej metody Google API
    }
  }

  // 2. Nowe Google Places API: AutocompleteSuggestion
  const anyPlaces = (placesLib || google.maps?.places) as unknown as {
    AutocompleteSuggestion?: {
      fetchAutocompleteSuggestions: (req: {
        input: string;
      }) => Promise<{
        suggestions: Array<{
          placePrediction?: {
            placeId: string;
            mainText?: { text: string };
            secondaryText?: { text: string };
            text?: { text: string };
            types?: string[];
          };
        }>;
      }>;
    };
  };

  if (anyPlaces?.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
    try {
      const { suggestions } =
        await anyPlaces.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: trimmed,
        });
      const mapped = (suggestions || [])
        .map((s) => s.placePrediction)
        .filter((p): p is NonNullable<typeof p> => Boolean(p && p.placeId))
        .slice(0, 7)
        .map((p) => ({
          placeId: p.placeId,
          mainText: p.mainText?.text || p.text?.text || trimmed,
          secondaryText: p.secondaryText?.text || '',
          types: p.types || [],
        }));
      if (mapped.length > 0) return mapped;
    } catch {
      // Przejdź do Geocodera
    }
  }

  // 3. Fallback: Google Maps Geocoder
  if (google.maps?.Geocoder) {
    try {
      const geocoder = new google.maps.Geocoder();
      const { results } = await geocoder.geocode({ address: trimmed });
      return (results || []).slice(0, 6).map((r) => {
        const parts = (r.formatted_address || trimmed).split(',');
        const mainText = parts[0]?.trim() || trimmed;
        const secondaryText = parts.slice(1).join(',').trim();
        return {
          placeId: r.place_id,
          mainText,
          secondaryText,
          types: r.types || [],
        };
      });
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * Pobiera szczegóły miejsca z Google po `placeId`.
 * Adres i kategoria trafiają na swoje dedykowane pola, a opis pozostaje pusty (opcjonalny dla użytkownika).
 */
export async function fetchGooglePlaceById(
  placeId: string,
  placesLib: google.maps.PlacesLibrary | null,
  map: google.maps.Map | null,
  fallbackCoords?: { lat: number; lng: number },
  fallbackTitle?: string
): Promise<ResolvedGooglePlace | null> {
  // 1. Klasyczne Google PlacesService.getDetails
  if (placesLib && map && placesLib.PlacesService) {
    try {
      const service = new placesLib.PlacesService(map);
      const detail = await new Promise<google.maps.places.PlaceResult>(
        (resolve, reject) => {
          service.getDetails(
            {
              placeId,
              fields: [
                'place_id',
                'name',
                'formatted_address',
                'geometry',
                'types',
                'rating',
                'photos',
              ],
            },
            (res, status) => {
              if (status === placesLib.PlacesServiceStatus.OK && res) {
                resolve(res);
              } else {
                reject(new Error(status));
              }
            }
          );
        }
      );

      const lat = detail.geometry?.location?.lat() ?? fallbackCoords?.lat;
      const lng = detail.geometry?.location?.lng() ?? fallbackCoords?.lng;
      if (lat !== undefined && lng !== undefined) {
        const types = detail.types || [];
        const tags = extractPolishTags(types);
        const name = detail.name || fallbackTitle || 'Wybrane miejsce';
        const address = detail.formatted_address || '';
        const photoUrl = detail.photos?.[0]?.getUrl({
          maxWidth: 800,
          maxHeight: 500,
        });

        return {
          place: {
            id: detail.place_id || placeId,
            name,
            category: tags[0] || 'Miejsce',
            tier: 1,
            lat,
            lng,
            description: '',
            address,
            tags,
            rating: detail.rating,
            photoUrl,
          },
          isCityOrRegion: isRegionOrCityTypes(types),
          recommendedZoom: getRecommendedZoomForTypes(types),
        };
      }
    } catch {
      // Spróbuj przez nowe Places API lub Geocoder
    }
  }

  // 2. Nowe Google Places API: new google.maps.places.Place({ id })
  const anyPlaces = (placesLib || google.maps?.places) as unknown as {
    Place?: new (opts: { id: string }) => {
      fetchFields: (opts: { fields: string[] }) => Promise<{
        place: {
          id?: string;
          displayName?: string;
          formattedAddress?: string;
          location?: google.maps.LatLng;
          types?: string[];
          rating?: number;
          photos?: Array<{
            getURI?: (opts: { maxWidth?: number; maxHeight?: number }) => string;
          }>;
        };
      }>;
    };
  };

  if (anyPlaces?.Place) {
    try {
      const gPlace = new anyPlaces.Place({ id: placeId });
      const { place: p } = await gPlace.fetchFields({
        fields: [
          'displayName',
          'formattedAddress',
          'location',
          'types',
          'rating',
          'photos',
        ],
      });

      const lat = p.location?.lat() ?? fallbackCoords?.lat;
      const lng = p.location?.lng() ?? fallbackCoords?.lng;
      if (lat !== undefined && lng !== undefined) {
        const types = p.types || [];
        const tags = extractPolishTags(types);
        const name = p.displayName || fallbackTitle || 'Wybrane miejsce';
        const address = p.formattedAddress || '';
        const photoUrl = p.photos?.[0]?.getURI?.({
          maxWidth: 800,
          maxHeight: 500,
        });

        return {
          place: {
            id: p.id || placeId,
            name,
            category: tags[0] || 'Miejsce',
            tier: 1,
            lat,
            lng,
            description: '',
            address,
            tags,
            rating: p.rating,
            photoUrl,
          },
          isCityOrRegion: isRegionOrCityTypes(types),
          recommendedZoom: getRecommendedZoomForTypes(types),
        };
      }
    } catch {
      // Spróbuj przez Geocoder
    }
  }

  // 3. Fallback: Google Maps Geocoder po placeId
  if (typeof google !== 'undefined' && google.maps?.Geocoder) {
    try {
      const geocoder = new google.maps.Geocoder();
      const { results } = await geocoder.geocode({ placeId });
      const first = results?.[0];
      const lat = first?.geometry?.location?.lat() ?? fallbackCoords?.lat;
      const lng = first?.geometry?.location?.lng() ?? fallbackCoords?.lng;
      if (first && lat !== undefined && lng !== undefined) {
        const types = first.types || [];
        const tags = extractPolishTags(types);
        const name =
          fallbackTitle ||
          first.address_components?.[0]?.long_name ||
          first.formatted_address?.split(',')[0] ||
          'Wybrane miejsce';
        const address = first.formatted_address || '';

        return {
          place: {
            id: first.place_id || placeId,
            name,
            category: tags[0] || 'Miejsce',
            tier: 1,
            lat,
            lng,
            description: '',
            address,
            tags,
          },
          isCityOrRegion: isRegionOrCityTypes(types),
          recommendedZoom: getRecommendedZoomForTypes(types),
        };
      }
    } catch {
      // Ignoruj
    }
  }

  if (fallbackCoords) {
    const coordsLabel = `${fallbackCoords.lat.toFixed(4)}, ${fallbackCoords.lng.toFixed(4)}`;
    return {
      place: {
        id: placeId,
        name: fallbackTitle || 'Wybrany obiekt',
        category: 'Miejsce',
        tier: 1,
        lat: fallbackCoords.lat,
        lng: fallbackCoords.lng,
        description: '',
        address: coordsLabel,
        tags: ['Miejsce'],
      },
      isCityOrRegion: false,
      recommendedZoom: 16,
    };
  }

  return null;
}

export interface MapBoundsInfo {
  north: number;
  south: number;
  east: number;
  west: number;
  centerLat: number;
  centerLng: number;
  zoom: number;
}

export interface RecommendationCategory {
  id: string;
  label: string;
  queryKeywords: string;
  nearbyKeyword: string;
  googleTypes: string[];
  polishCategory: string;
}

export const RECOMMENDATION_CATEGORIES: RecommendationCategory[] = [
  {
    id: 'monuments',
    label: 'Zabytki',
    queryKeywords: 'top historical landmarks monuments castle',
    nearbyKeyword: 'monument castle landmark historic',
    googleTypes: ['tourist_attraction', 'historical_landmark'],
    polishCategory: 'Zabytek',
  },
  {
    id: 'distilleries',
    label: 'Destylarnie i browary',
    queryKeywords: 'distillery whiskey brewery tour tasting',
    nearbyKeyword: 'distillery brewery browar destylarnia',
    googleTypes: ['bar', 'liquor_store', 'tourist_attraction'],
    polishCategory: 'Destylarnia / Browar',
  },
  {
    id: 'bars',
    label: 'Bary i puby',
    queryKeywords: 'best bars pubs cocktail bar',
    nearbyKeyword: 'bar pub cocktail',
    googleTypes: ['bar'],
    polishCategory: 'Bar / Pub',
  },
  {
    id: 'restaurants',
    label: 'Restauracje',
    queryKeywords: 'best restaurants local food',
    nearbyKeyword: 'restaurant',
    googleTypes: ['restaurant'],
    polishCategory: 'Restauracja',
  },
  {
    id: 'viewpoints',
    label: 'Widoki',
    queryKeywords: 'scenic viewpoint observation deck panorama',
    nearbyKeyword: 'viewpoint observation deck panorama punkt widokowy',
    googleTypes: ['tourist_attraction'],
    polishCategory: 'Punkt widokowy',
  },
  {
    id: 'cafes',
    label: 'Kawiarnie',
    queryKeywords: 'best specialty coffee cafe bakery',
    nearbyKeyword: 'cafe coffee kawiarnia',
    googleTypes: ['cafe'],
    polishCategory: 'Kawiarnia',
  },
  {
    id: 'museums',
    label: 'Muzea',
    queryKeywords: 'best museums art gallery',
    nearbyKeyword: 'museum gallery muzeum',
    googleTypes: ['museum', 'art_gallery'],
    polishCategory: 'Muzeum',
  },
  {
    id: 'nature',
    label: 'Natura i parki',
    queryKeywords: 'scenic park botanical garden cliffs nature',
    nearbyKeyword: 'park botanical garden nature',
    googleTypes: ['park'],
    polishCategory: 'Natura',
  },
];

export interface RecommendedSearchResult {
  places: Place[];
  regionCenter?: { lat: number; lng: number; zoom: number };
}

export interface FetchRecommendedOptions {
  regionQuery?: string;
  selectedCategoryIds: string[];
  visibleBounds?: MapBoundsInfo | null;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function buildOverpassClausesForCategory(
  categoryId: string,
  bboxStr: string
): string[] {
  switch (categoryId) {
    case 'monuments':
      return [
        `node["historic"~"monument|memorial|castle|ruins|archaeological_site|fort|palace"]["name"](${bboxStr});`,
        `way["historic"~"monument|memorial|castle|ruins|archaeological_site|fort|palace"]["name"](${bboxStr});`,
        `node["tourism"="attraction"]["name"](${bboxStr});`,
        `way["tourism"="attraction"]["name"](${bboxStr});`,
      ];
    case 'distilleries':
      return [
        `node["craft"~"distillery|brewery|winery"]["name"](${bboxStr});`,
        `way["craft"~"distillery|brewery|winery"]["name"](${bboxStr});`,
        `node["microbrewery"="yes"]["name"](${bboxStr});`,
        `way["microbrewery"="yes"]["name"](${bboxStr});`,
        `node["industrial"~"brewery|distillery"]["name"](${bboxStr});`,
      ];
    case 'bars':
      return [
        `node["amenity"~"bar|pub|biergarten"]["name"](${bboxStr});`,
        `way["amenity"~"bar|pub|biergarten"]["name"](${bboxStr});`,
      ];
    case 'restaurants':
      return [
        `node["amenity"="restaurant"]["name"](${bboxStr});`,
        `way["amenity"="restaurant"]["name"](${bboxStr});`,
      ];
    case 'viewpoints':
      return [
        `node["tourism"="viewpoint"]["name"](${bboxStr});`,
        `node["tourism"="viewpoint"](${bboxStr});`,
      ];
    case 'cafes':
      return [
        `node["amenity"="cafe"]["name"](${bboxStr});`,
        `way["amenity"="cafe"]["name"](${bboxStr});`,
      ];
    case 'museums':
      return [
        `node["tourism"~"museum|gallery"]["name"](${bboxStr});`,
        `way["tourism"~"museum|gallery"]["name"](${bboxStr});`,
      ];
    case 'nature':
      return [
        `node["leisure"~"park|nature_reserve|garden"]["name"](${bboxStr});`,
        `way["leisure"~"park|nature_reserve|garden"]["name"](${bboxStr});`,
        `node["natural"~"peak|cliff|beach|waterfall"]["name"](${bboxStr});`,
      ];
    default:
      return [];
  }
}

function classifyOverpassElement(
  tags: Record<string, string>,
  selectedCategories: RecommendationCategory[]
): RecommendationCategory {
  if (
    tags.craft === 'distillery' ||
    tags.craft === 'brewery' ||
    tags.craft === 'winery' ||
    tags.microbrewery === 'yes' ||
    tags.industrial === 'brewery' ||
    tags.industrial === 'distillery'
  ) {
    return (
      selectedCategories.find((c) => c.id === 'distilleries') ||
      selectedCategories[0]
    );
  }
  if (tags.amenity === 'cafe') {
    return (
      selectedCategories.find((c) => c.id === 'cafes') || selectedCategories[0]
    );
  }
  if (
    tags.amenity === 'bar' ||
    tags.amenity === 'pub' ||
    tags.amenity === 'biergarten'
  ) {
    return (
      selectedCategories.find((c) => c.id === 'bars') || selectedCategories[0]
    );
  }
  if (tags.amenity === 'restaurant') {
    return (
      selectedCategories.find((c) => c.id === 'restaurants') ||
      selectedCategories[0]
    );
  }
  if (tags.tourism === 'viewpoint') {
    return (
      selectedCategories.find((c) => c.id === 'viewpoints') ||
      selectedCategories[0]
    );
  }
  if (tags.tourism === 'museum' || tags.tourism === 'gallery') {
    return (
      selectedCategories.find((c) => c.id === 'museums') ||
      selectedCategories[0]
    );
  }
  if (tags.leisure || tags.natural) {
    return (
      selectedCategories.find((c) => c.id === 'nature') ||
      selectedCategories[0]
    );
  }
  return (
    selectedCategories.find((c) => c.id === 'monuments') ||
    selectedCategories[0]
  );
}

async function fetchFromOverpassFallback(
  bbox: { south: number; west: number; north: number; east: number },
  categories: RecommendationCategory[]
): Promise<Place[]> {
  // Ogranicz rozmiar bboxa (np. gdy mapa jest mocno oddalona), żeby zapytanie było szybkie i trafne
  const centerLat = (bbox.north + bbox.south) / 2;
  const centerLng = (bbox.east + bbox.west) / 2;
  const maxHalfSpan = 0.08; // ok. 8-9 km od środka
  const halfLat = Math.min(
    Math.max((bbox.north - bbox.south) / 2, 0.015),
    maxHalfSpan
  );
  const halfLng = Math.min(
    Math.max((bbox.east - bbox.west) / 2, 0.02),
    maxHalfSpan * 1.3
  );

  const clampedSouth = (centerLat - halfLat).toFixed(5);
  const clampedWest = (centerLng - halfLng).toFixed(5);
  const clampedNorth = (centerLat + halfLat).toFixed(5);
  const clampedEast = (centerLng + halfLng).toFixed(5);
  const bboxStr = `${clampedSouth},${clampedWest},${clampedNorth},${clampedEast}`;

  const clauses = categories.flatMap((cat) =>
    buildOverpassClausesForCategory(cat.id, bboxStr)
  );
  if (clauses.length === 0) return [];

  const query = `[out:json][timeout:12];(${clauses.join('')});out center 80;`;
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { elements?: OverpassElement[] };
      const elements = data.elements || [];
      if (elements.length === 0) continue;

      const byNameAndCoords = new Map<
        string,
        { place: Place; popularityScore: number }
      >();

      for (const el of elements) {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        const tags = el.tags || {};
        const matchedCat = classifyOverpassElement(tags, categories);
        const rawName =
          tags['name:pl'] ||
          tags.name ||
          tags['name:en'] ||
          (matchedCat.id === 'viewpoints' ? 'Punkt widokowy' : '');
        if (!rawName || lat === undefined || lng === undefined) continue;

        const dedupeKey = `${rawName.toLowerCase()}_${lat.toFixed(3)}_${lng.toFixed(3)}`;
        const street = tags['addr:street'] || '';
        const houseNumber = tags['addr:housenumber'] || '';
        const city = tags['addr:city'] || '';
        const addressParts = [
          [street, houseNumber].filter(Boolean).join(' '),
          city,
        ].filter(Boolean);
        const address = addressParts.join(', ');

        let score = 1;
        if (tags.wikidata || tags.wikipedia) score += 5;
        if (tags.website || tags['contact:website']) score += 2;
        if (tags.image || tags.wikimedia_commons) score += 3;
        if (tags.opening_hours) score += 1;
        if (address) score += 1;
        if (tags.stars) score += 2;

        // Przybliżona ocena gwiazdkowa na podstawie bogactwa metadanych (4.2 - 4.9)
        const pseudoRating = Math.min(4.9, 4.1 + Math.min(score, 8) * 0.1);

        let photoUrl: string | undefined;
        if (
          tags.image &&
          (tags.image.startsWith('http://') ||
            tags.image.startsWith('https://'))
        ) {
          photoUrl = tags.image;
        }

        const existing = byNameAndCoords.get(dedupeKey);
        if (existing) {
          if (!existing.place.tags.includes(matchedCat.polishCategory)) {
            existing.place.tags = [
              ...existing.place.tags,
              matchedCat.polishCategory,
            ];
          }
          continue;
        }

        byNameAndCoords.set(dedupeKey, {
          popularityScore: score,
          place: {
            id: `osm-${el.type}-${el.id}`,
            name: rawName,
            category: matchedCat.polishCategory,
            tier: 1,
            lat,
            lng,
            description: '',
            address,
            tags: [matchedCat.polishCategory],
            rating: Number(pseudoRating.toFixed(1)),
            photoUrl,
          },
        });
      }

      return Array.from(byNameAndCoords.values())
        .sort((a, b) => b.popularityScore - a.popularityScore)
        .slice(0, 30)
        .map((item) => item.place);
    } catch {
      // Spróbuj kolejny serwer Overpass
    }
  }

  return [];
}

/**
 * Dociąga zdjęcie dla wybranego miejsca (np. z Wikimedia Commons w promieniu 300 m),
 * gdy miejsce pochodzi z wyszukiwania obszarowego i nie ma jeszcze zdjęcia.
 */
export async function fetchPhotoForCoordinates(
  lat: number,
  lng: number
): Promise<string | null> {
  try {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat}|${lng}&ggsradius=350&ggslimit=1&prop=imageinfo&iiprop=url&iiurlwidth=700&format=json&origin=*`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          { imageinfo?: Array<{ thumburl?: string; url?: string }> }
        >;
      };
    };
    const pages = data.query?.pages;
    if (!pages) return null;
    const firstPage = Object.values(pages)[0];
    return (
      firstPage?.imageinfo?.[0]?.thumburl ||
      firstPage?.imageinfo?.[0]?.url ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Wyszukuje polecane miejsca albo w wpisanym regionie/mieście, albo bezpośrednio
 * na aktualnie widocznym obszarze mapy (`visibleBounds`).
 */
export async function fetchRecommendedPlaces(
  options: FetchRecommendedOptions
): Promise<RecommendedSearchResult> {
  const { regionQuery = '', selectedCategoryIds, visibleBounds } = options;
  if (selectedCategoryIds.length === 0) {
    return { places: [] };
  }

  const trimmedRegion = regionQuery.trim();
  let regionCenter: { lat: number; lng: number; zoom: number } | undefined;
  let searchBbox: {
    south: number;
    west: number;
    north: number;
    east: number;
  } | null = null;

  // 1. Jeśli użytkownik wybrał "Szukaj na widocznej mapie" (lub nie wpisał regionu, a mamy widoczną mapę)
  if (!trimmedRegion && visibleBounds) {
    searchBbox = {
      south: visibleBounds.south,
      west: visibleBounds.west,
      north: visibleBounds.north,
      east: visibleBounds.east,
    };
  } else if (trimmedRegion) {
    // 2. Użytkownik wpisał konkretny region / miasto — ustal współrzędne (Geocoder Google -> Nominatim OSM)
    if (typeof google !== 'undefined' && google.maps?.Geocoder) {
      try {
        const geocoder = new google.maps.Geocoder();
        const { results } = await geocoder.geocode({ address: trimmedRegion });
        const first = results?.[0];
        const loc = first?.geometry?.location;
        if (first && loc) {
          const zoom = getRecommendedZoomForTypes(first.types);
          const lat = loc.lat();
          const lng = loc.lng();
          regionCenter = {
            lat,
            lng,
            zoom: zoom > 13 ? 13 : zoom,
          };
          const vp = first.geometry?.viewport;
          if (vp) {
            const ne = vp.getNorthEast();
            const sw = vp.getSouthWest();
            searchBbox = {
              south: sw.lat(),
              west: sw.lng(),
              north: ne.lat(),
              east: ne.lng(),
            };
          } else {
            searchBbox = {
              south: lat - 0.05,
              west: lng - 0.07,
              north: lat + 0.05,
              east: lng + 0.07,
            };
          }
        }
      } catch {
        // Przejdź do Nominatim
      }
    }

    // Fallback geokodowania: OpenStreetMap Nominatim (gdy Geocoding API w Google nie jest aktywne)
    if (!regionCenter) {
      try {
        const nomRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            trimmedRegion
          )}&limit=1&accept-language=pl`
        );
        if (nomRes.ok) {
          const nomItems = (await nomRes.json()) as Array<{
            lat: string;
            lon: string;
            boundingbox?: [string, string, string, string];
          }>;
          const first = nomItems[0];
          if (first) {
            const lat = parseFloat(first.lat);
            const lng = parseFloat(first.lon);
            regionCenter = { lat, lng, zoom: 13 };
            if (first.boundingbox && first.boundingbox.length === 4) {
              searchBbox = {
                south: parseFloat(first.boundingbox[0]),
                north: parseFloat(first.boundingbox[1]),
                west: parseFloat(first.boundingbox[2]),
                east: parseFloat(first.boundingbox[3]),
              };
            } else {
              searchBbox = {
                south: lat - 0.05,
                west: lng - 0.07,
                north: lat + 0.05,
                east: lng + 0.07,
              };
            }
          }
        }
      } catch {
        // Ignoruj
      }
    }
  }

  // Jeśli nadal nie mamy bboxa, użyj aktualnego widoku mapy
  if (!searchBbox && visibleBounds) {
    searchBbox = {
      south: visibleBounds.south,
      west: visibleBounds.west,
      north: visibleBounds.north,
      east: visibleBounds.east,
    };
  }

  const targetCenter = regionCenter
    ? { lat: regionCenter.lat, lng: regionCenter.lng }
    : visibleBounds
    ? { lat: visibleBounds.centerLat, lng: visibleBounds.centerLng }
    : { lat: 52.2297, lng: 21.0122 };

  if (!searchBbox) {
    searchBbox = {
      south: targetCenter.lat - 0.05,
      west: targetCenter.lng - 0.07,
      north: targetCenter.lat + 0.05,
      east: targetCenter.lng + 0.07,
    };
  }

  const categoriesToFetch = RECOMMENDATION_CATEGORIES.filter((c) =>
    selectedCategoryIds.includes(c.id)
  );

  const placesMap = new Map<string, Place>();

  // Załaduj bibliotekę places z Google Maps JS SDK jeśli jest dostępna
  const loadedPlacesLib =
    typeof google !== 'undefined' && google.maps?.importLibrary
      ? ((await google.maps
          .importLibrary('places')
          .catch(() => null)) as google.maps.PlacesLibrary | null)
      : null;

  // Pomocnicza funkcja wyszukująca jedną kategorię w Google Places API
  const searchCategoryInGoogle = async (cat: RecommendationCategory) => {
    if (typeof google === 'undefined') return;

    const textQuery = trimmedRegion
      ? `${cat.queryKeywords} in ${trimmedRegion}`
      : cat.queryKeywords;

    // A) Nowe Google Places API: Place.searchByText / Place.searchNearby
    const anyPlaces = (loadedPlacesLib || google.maps?.places) as unknown as {
      Place?: {
        searchByText?: (req: {
          textQuery: string;
          fields: string[];
          locationBias?: {
            center: { lat: number; lng: number };
            radius: number;
          };
          maxResultCount?: number;
        }) => Promise<{
          places?: Array<{
            id?: string;
            displayName?: string | { text?: string };
            formattedAddress?: string;
            location?: google.maps.LatLng;
            types?: string[];
            rating?: number;
            userRatingCount?: number;
            photos?: Array<{
              getURI?: (opts: {
                maxWidth?: number;
                maxHeight?: number;
              }) => string;
            }>;
          }>;
        }>;
      };
    };

    if (anyPlaces?.Place?.searchByText) {
      try {
        const { places } = await anyPlaces.Place.searchByText({
          textQuery,
          fields: [
            'id',
            'displayName',
            'formattedAddress',
            'location',
            'types',
            'rating',
            'userRatingCount',
            'photos',
          ],
          locationBias: {
            center: targetCenter,
            radius: 7000,
          },
          maxResultCount: 10,
        });

        let addedCount = 0;
        for (const p of places || []) {
          const id = p.id;
          const lat = p.location?.lat();
          const lng = p.location?.lng();
          if (!id || lat === undefined || lng === undefined) continue;
          if (p.rating !== undefined && p.rating < 3.9) continue;

          const existing = placesMap.get(id);
          if (existing) {
            if (!existing.tags.includes(cat.polishCategory)) {
              existing.tags = [...existing.tags, cat.polishCategory];
            }
            addedCount++;
            continue;
          }

          const rawName =
            typeof p.displayName === 'string'
              ? p.displayName
              : p.displayName?.text || 'Polecane miejsce';
          const photoUrl = p.photos?.[0]?.getURI?.({
            maxWidth: 600,
            maxHeight: 400,
          });
          const extractedTags = extractPolishTags(p.types);
          const mergedTags = Array.from(
            new Set([cat.polishCategory, ...extractedTags])
          );

          placesMap.set(id, {
            id,
            name: rawName,
            category: cat.polishCategory,
            tier: 1,
            lat,
            lng,
            description: '',
            address: p.formattedAddress || '',
            tags: mergedTags,
            rating: p.rating,
            userRatingsTotal: p.userRatingCount,
            photoUrl,
          });
          addedCount++;
        }
        if (addedCount > 0) return;
      } catch {
        // Przejdź do klasycznego PlacesService
      }
    }

    // B) Klasyczne Google PlacesService (nearbySearch + textSearch)
    if (google.maps?.places?.PlacesService) {
      try {
        const container = document.createElement('div');
        const service = new google.maps.places.PlacesService(container);
        const results = await new Promise<google.maps.places.PlaceResult[]>(
          (resolve) => {
            service.nearbySearch(
              {
                location: new google.maps.LatLng(
                  targetCenter.lat,
                  targetCenter.lng
                ),
                radius: 6000,
                keyword: cat.nearbyKeyword,
              },
              (res, status) => {
                if (
                  status === google.maps.places.PlacesServiceStatus.OK &&
                  res &&
                  res.length > 0
                ) {
                  resolve(res);
                } else {
                  service.textSearch(
                    {
                      query: textQuery,
                      location: new google.maps.LatLng(
                        targetCenter.lat,
                        targetCenter.lng
                      ),
                      radius: 6000,
                    },
                    (res2, status2) => {
                      if (
                        status2 === google.maps.places.PlacesServiceStatus.OK &&
                        res2
                      ) {
                        resolve(res2);
                      } else {
                        resolve([]);
                      }
                    }
                  );
                }
              }
            );
          }
        );

        for (const item of results.slice(0, 10)) {
          const id = item.place_id;
          const lat = item.geometry?.location?.lat();
          const lng = item.geometry?.location?.lng();
          if (!id || lat === undefined || lng === undefined) continue;
          if (item.rating !== undefined && item.rating < 3.9) continue;

          const existing = placesMap.get(id);
          if (existing) {
            if (!existing.tags.includes(cat.polishCategory)) {
              existing.tags = [...existing.tags, cat.polishCategory];
            }
            continue;
          }

          const photoUrl = item.photos?.[0]?.getUrl({
            maxWidth: 600,
            maxHeight: 400,
          });
          const extractedTags = extractPolishTags(item.types);
          const mergedTags = Array.from(
            new Set([cat.polishCategory, ...extractedTags])
          );

          placesMap.set(id, {
            id,
            name: item.name || 'Polecane miejsce',
            category: cat.polishCategory,
            tier: 1,
            lat,
            lng,
            description: '',
            address: item.formatted_address || item.vicinity || '',
            tags: mergedTags,
            rating: item.rating,
            userRatingsTotal: item.user_ratings_total,
            photoUrl,
          });
        }
      } catch {
        // Ignoruj błędy pojedynczej kategorii
      }
    }
  };

  await Promise.all(categoriesToFetch.map((cat) => searchCategoryInGoogle(cat)));

  // C) Fallback: jeśli Google Places API nie zwróciło wyników (np. ograniczenia klucza API),
  // pobierz prawdziwe miejsca z wybranego obszaru mapy przez OpenStreetMap Overpass API
  if (placesMap.size === 0 && searchBbox) {
    const osmPlaces = await fetchFromOverpassFallback(
      searchBbox,
      categoriesToFetch
    );
    for (const p of osmPlaces) {
      placesMap.set(p.id, p);
    }
  }

  const sortedPlaces = Array.from(placesMap.values()).sort((a, b) => {
    const scoreA =
      (a.rating || 4.2) * Math.log10((a.userRatingsTotal || 20) + 10);
    const scoreB =
      (b.rating || 4.2) * Math.log10((b.userRatingsTotal || 20) + 10);
    return scoreB - scoreA;
  });

  return {
    places: sortedPlaces,
    regionCenter,
  };
}
