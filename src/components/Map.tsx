import React, { useEffect, useRef } from 'react';
import {
  Map as GoogleMap,
  AdvancedMarker,
  CollisionBehavior,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import type { MapStyle, Place } from '../types/trip';
import {
  fetchGooglePlaceById,
  fetchPhotoForCoordinates,
  type MapBoundsInfo,
} from '../utils/googlePlaces';

export type { MapStyle, Place, MapBoundsInfo };

export interface MapFocusTarget {
  lat: number;
  lng: number;
  zoom?: number;
}

export interface SecondaryMapPlace {
  place: Place;
  dayNumber: number;
  indexInDay: number;
}

interface MapProps {
  places: Place[];
  secondaryPlaces?: SecondaryMapPlace[];
  overviewSavedPlaces?: Place[];
  isOverviewMode?: boolean;
  isRecommendationsMode?: boolean;
  allListedPlaceIds?: Set<string>;
  previewPlace?: Place | null;
  selectedPlaceId?: string | null;
  routePath?: { lat: number; lng: number }[];
  showRouteLine?: boolean;
  mapStyle: MapStyle;
  theme: 'light' | 'dark';
  onSelectPlace: (place: Place, dayNumber?: number) => void;
  onMapPoiClick: (place: Place) => void;
  onPlacePhotoLoaded?: (placeId: string, photoUrl: string) => void;
  onBoundsChanged?: (bounds: MapBoundsInfo) => void;
  onUserMovedMap?: () => void;
  focusLocation?: MapFocusTarget | null;
}

const MapController = ({
  focusLocation,
}: {
  focusLocation?: MapFocusTarget | null;
}) => {
  const map = useMap();
  useEffect(() => {
    if (map && focusLocation) {
      map.panTo({ lat: focusLocation.lat, lng: focusLocation.lng });
      if (focusLocation.zoom) {
        map.setZoom(focusLocation.zoom);
      } else if ((map.getZoom() ?? 13) < 14) {
        map.setZoom(15);
      }
    }
  }, [map, focusLocation]);
  return null;
};

const RoutePolyline = ({
  path,
  isCalculatedRoute,
}: {
  path: { lat: number; lng: number }[];
  isCalculatedRoute: boolean;
}) => {
  const map = useMap();

  useEffect(() => {
    if (!map || path.length < 2 || typeof google === 'undefined') return;

    const polyline = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: isCalculatedRoute ? '#4f46e5' : '#818cf8',
      strokeOpacity: isCalculatedRoute ? 0.9 : 0.65,
      strokeWeight: isCalculatedRoute ? 5 : 3,
      icons: isCalculatedRoute
        ? [
            {
              icon: {
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 3,
                strokeColor: '#4f46e5',
                fillColor: '#ffffff',
                fillOpacity: 1,
              },
              offset: '50%',
              repeat: '120px',
            },
          ]
        : undefined,
    });

    polyline.setMap(map);

    return () => {
      polyline.setMap(null);
    };
  }, [map, path, isCalculatedRoute]);

  return null;
};

export const Map: React.FC<MapProps> = ({
  places,
  secondaryPlaces = [],
  overviewSavedPlaces = [],
  isOverviewMode = false,
  isRecommendationsMode = false,
  allListedPlaceIds,
  previewPlace,
  selectedPlaceId,
  routePath,
  showRouteLine = true,
  mapStyle,
  theme,
  onSelectPlace,
  onMapPoiClick,
  onPlacePhotoLoaded,
  onBoundsChanged,
  onUserMovedMap,
  focusLocation,
}) => {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const attemptedPhotosRef = useRef<Set<string>>(new Set());

  // Śledź aktualnie widoczny obszar mapy oraz ręczne przesunięcie mapy przez użytkownika
  useEffect(() => {
    if (!map) return;

    const emitBounds = () => {
      const bounds = map.getBounds();
      const center = map.getCenter();
      if (!bounds || !center || !onBoundsChanged) return;
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      onBoundsChanged({
        north: ne.lat(),
        south: sw.lat(),
        east: ne.lng(),
        west: sw.lng(),
        centerLat: center.lat(),
        centerLng: center.lng(),
        zoom: map.getZoom() ?? 13,
      });
    };

    emitBounds();
    const idleListener = map.addListener('idle', emitBounds);
    const dragListener = map.addListener('dragend', () => {
      emitBounds();
      onUserMovedMap?.();
    });

    return () => {
      idleListener.remove();
      dragListener.remove();
    };
  }, [map, onBoundsChanged, onUserMovedMap]);

  // Dociągnij zdjęcie z Google lub Wikimedia jeśli zaznaczone miejsce jeszcze go nie ma
  useEffect(() => {
    if (
      !previewPlace ||
      previewPlace.photoUrl ||
      !previewPlace.id ||
      previewPlace.id.startsWith('custom-') ||
      attemptedPhotosRef.current.has(previewPlace.id)
    ) {
      return;
    }

    attemptedPhotosRef.current.add(previewPlace.id);

    if (previewPlace.id.startsWith('osm-')) {
      void fetchPhotoForCoordinates(previewPlace.lat, previewPlace.lng).then(
        (photoUrl) => {
          if (photoUrl && onPlacePhotoLoaded) {
            onPlacePhotoLoaded(previewPlace.id, photoUrl);
          }
        }
      );
      return;
    }

    if (!placesLib || !map) return;

    void fetchGooglePlaceById(
      previewPlace.id,
      placesLib,
      map,
      { lat: previewPlace.lat, lng: previewPlace.lng },
      previewPlace.name
    ).then(async (resolved) => {
      if (resolved?.place.photoUrl && onPlacePhotoLoaded) {
        onPlacePhotoLoaded(previewPlace.id, resolved.place.photoUrl);
      } else if (onPlacePhotoLoaded) {
        const wikiPhoto = await fetchPhotoForCoordinates(
          previewPlace.lat,
          previewPlace.lng
        );
        if (wikiPhoto) {
          onPlacePhotoLoaded(previewPlace.id, wikiPhoto);
        }
      }
    });
  }, [previewPlace, placesLib, map, onPlacePhotoLoaded]);

  const mapType = mapStyle === 'satellite' ? 'hybrid' : 'roadmap';

  const polylineCoords = !showRouteLine
    ? []
    : routePath && routePath.length >= 2
    ? routePath
    : places.map((p) => ({ lat: p.lat, lng: p.lng }));

  // Sprawdź, czy podglądane miejsce jest już na jakiejkolwiek liście (w aktywnym dniu, innym dniu lub Zapisanych)
  const isPreviewAlreadyListed = previewPlace
    ? Boolean(
        allListedPlaceIds?.has(previewPlace.id) ||
          places.some((p) => p.id === previewPlace.id) ||
          secondaryPlaces.some((sp) => sp.place.id === previewPlace.id)
      )
    : false;

  return (
    <GoogleMap
      defaultCenter={{ lat: 52.0692, lng: 19.4803 }} // Polska
      defaultZoom={6}
      mapId="DEMO_MAP_ID"
      gestureHandling="greedy"
      mapTypeId={mapType}
      colorScheme={theme === 'dark' ? 'DARK' : 'LIGHT'}
      disableDefaultUI={true}
      zoomControl={true}
      clickableIcons={true}
      onClick={(e) => {
        const { placeId, latLng } = e.detail;
        if (!latLng || !placeId) return;

        e.stop();
        void fetchGooglePlaceById(placeId, placesLib, map, {
          lat: latLng.lat,
          lng: latLng.lng,
        }).then((resolved) => {
          if (resolved) {
            onMapPoiClick(resolved.place);
          }
        });
      }}
      className="h-full w-full outline-none"
    >
      <MapController focusLocation={focusLocation} />

      <RoutePolyline
        path={polylineCoords}
        isCalculatedRoute={Boolean(routePath && routePath.length >= 2)}
      />

      {/* WYSZARZONE MARKERY: Miejsca z pozostałych dni w secie */}
      {secondaryPlaces.map(({ place, dayNumber, indexInDay }) => {
        const isSelected = selectedPlaceId === place.id;
        return (
          <AdvancedMarker
            key={`sec-${dayNumber}-${place.id}`}
            position={{ lat: place.lat, lng: place.lng }}
            anchorLeft="-50%"
            anchorTop="-50%"
            collisionBehavior={CollisionBehavior.REQUIRED_AND_HIDES_OPTIONAL}
            onClick={() => onSelectPlace(place, dayNumber)}
            title={`Dzień ${dayNumber}: ${indexInDay}. ${place.name}`}
            zIndex={isSelected ? 190 : 40 + indexInDay}
          >
            <div
              className={`flex items-center justify-center rounded-full border-2 border-white font-bold shadow-md transition-transform ${
                isSelected
                  ? 'h-9 w-9 scale-110 bg-slate-600 text-xs text-white ring-4 ring-slate-400/40'
                  : 'h-7 w-7 bg-slate-400 text-[11px] text-white/95 opacity-80 hover:scale-110 hover:opacity-100'
              }`}
            >
              {indexInDay}
            </div>
          </AdvancedMarker>
        );
      })}

      {/* POMARAŃCZOWE MARKERY W WIDOKU OGÓLNYM: Miejsca z Zapisanych (gdy żadna zakładka nie jest zaznaczona) */}
      {overviewSavedPlaces.map((place, index) => {
        const isSelected = selectedPlaceId === place.id;
        return (
          <AdvancedMarker
            key={`ov-saved-${place.id}`}
            position={{ lat: place.lat, lng: place.lng }}
            anchorLeft="-50%"
            anchorTop="-50%"
            collisionBehavior={CollisionBehavior.REQUIRED_AND_HIDES_OPTIONAL}
            onClick={() => onSelectPlace(place)}
            title={`Zapisane: ${place.name}`}
            zIndex={isSelected ? 220 : 80 + index}
          >
            <div
              className={`flex items-center justify-center rounded-full border-2 border-white font-bold text-white shadow-lg transition-transform ${
                isSelected
                  ? 'h-9 w-9 scale-110 bg-amber-500 text-sm ring-4 ring-amber-400/40'
                  : 'h-7 w-7 bg-amber-500 text-xs hover:scale-110'
              }`}
            >
              ★
            </div>
          </AdvancedMarker>
        );
      })}

      {/* GŁÓWNE MARKERY: Miejsca z setów (niebieskie), Polecane (zielone) lub z Zapisanych (pomarańczowe) */}
      {places.map((place, index) => {
        const isSelected = selectedPlaceId === place.id;
        const isBlueSetMarker = showRouteLine || isOverviewMode;
        return (
          <AdvancedMarker
            key={place.id}
            position={{ lat: place.lat, lng: place.lng }}
            anchorLeft="-50%"
            anchorTop="-50%"
            collisionBehavior={CollisionBehavior.REQUIRED_AND_HIDES_OPTIONAL}
            onClick={() => onSelectPlace(place)}
            title={
              showRouteLine || isRecommendationsMode
                ? `${index + 1}. ${place.name}`
                : place.name
            }
            zIndex={isSelected ? 220 : 100 + index}
          >
            <div
              className={`flex items-center justify-center rounded-full border-2 border-white font-bold text-white shadow-lg transition-transform ${
                isSelected
                  ? 'h-9 w-9 scale-110 bg-amber-500 text-sm ring-4 ring-amber-400/40'
                  : isRecommendationsMode
                  ? 'h-7 w-7 bg-emerald-600 text-[11px] hover:scale-110'
                  : isBlueSetMarker
                  ? 'h-8 w-8 bg-indigo-600 text-xs hover:scale-110'
                  : 'h-7 w-7 bg-amber-500 text-xs hover:scale-110'
              }`}
            >
              {showRouteLine || isRecommendationsMode
                ? index + 1
                : isOverviewMode
                ? '•'
                : '★'}
            </div>
          </AdvancedMarker>
        );
      })}

      {/* Marker podglądu wyświetla się TYLKO gdy miejsce NIE zostało jeszcze dodane do żadnej listy */}
      {previewPlace && !isPreviewAlreadyListed && (
        <AdvancedMarker
          position={{ lat: previewPlace.lat, lng: previewPlace.lng }}
          collisionBehavior={CollisionBehavior.REQUIRED_AND_HIDES_OPTIONAL}
          onClick={() => onSelectPlace(previewPlace)}
          title={previewPlace.name}
          zIndex={250}
        >
          <div className="flex flex-col items-center">
            <div className="rounded-full border-2 border-white bg-rose-500 px-2.5 py-1 text-[11px] font-bold text-white shadow-xl ring-4 ring-rose-500/30">
              {previewPlace.name}
            </div>
            <div className="h-2.5 w-2.5 -mt-1 rotate-45 bg-rose-500" />
          </div>
        </AdvancedMarker>
      )}
    </GoogleMap>
  );
};
