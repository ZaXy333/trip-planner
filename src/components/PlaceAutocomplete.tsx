import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { Search, MapPin, Compass, X, Loader2 } from 'lucide-react';
import type { Place } from '../types/trip';
import {
  fetchGoogleAutocompletePredictions,
  fetchGooglePlaceById,
  isRegionOrCityTypes,
  type GooglePredictionItem,
} from '../utils/googlePlaces';
import { extractPolishTags } from '../utils/routeUtils';

export interface PlaceSelectMeta {
  isCityOrRegion: boolean;
  zoom: number;
  query: string;
}

interface PlaceAutocompleteProps {
  onPlaceSelect: (place: Place, meta?: PlaceSelectMeta) => void;
}

export const PlaceAutocomplete = ({ onPlaceSelect }: PlaceAutocompleteProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const onPlaceSelectRef = useRef(onPlaceSelect);
  const map = useMap();
  const placesLib = useMapsLibrary('places');

  const [query, setQuery] = useState('');
  const [predictions, setPredictions] = useState<GooglePredictionItem[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    onPlaceSelectRef.current = onPlaceSelect;
  }, [onPlaceSelect]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setError('');
      try {
        const items = await fetchGoogleAutocompletePredictions(
          trimmed,
          placesLib,
          map
        );
        if (!cancelled) {
          setPredictions(items);
          setActiveIndex(items.length > 0 ? 0 : -1);
        }
      } catch {
        if (!cancelled) {
          setPredictions([]);
          setError('Nie udało się pobrać podpowiedzi z Google Maps.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, placesLib, map]);

  const handleSelectPrediction = async (item: GooglePredictionItem) => {
    setIsResolving(true);
    setError('');
    try {
      const resolved = await fetchGooglePlaceById(
        item.placeId,
        placesLib,
        map,
        undefined,
        item.mainText
      );
      if (resolved) {
        onPlaceSelectRef.current(resolved.place, {
          isCityOrRegion: resolved.isCityOrRegion,
          zoom: resolved.recommendedZoom,
          query: query.trim(),
        });
        setQuery('');
        setPredictions([]);
        setIsOpen(false);
      } else {
        setError('Nie udało się pobrać szczegółów wybranego miejsca.');
      }
    } finally {
      setIsResolving(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2 || isResolving) return;

    const chosen =
      predictions[activeIndex >= 0 ? activeIndex : 0] || null;
    if (chosen) {
      await handleSelectPrediction(chosen);
      return;
    }

    // Jeśli użytkownik nacisnął Enter zanim podpowiedzi się załadowały, pobierz teraz z Google
    setIsResolving(true);
    setError('');
    try {
      const freshItems = await fetchGoogleAutocompletePredictions(
        trimmed,
        placesLib,
        map
      );
      if (freshItems.length > 0) {
        await handleSelectPrediction(freshItems[0]);
      } else {
        setIsOpen(true);
        setError('Nie znaleziono pasującego miejsca w Google Maps.');
      }
    } finally {
      setIsResolving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || predictions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % predictions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) =>
        prev <= 0 ? predictions.length - 1 : prev - 1
      );
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative flex items-center">
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          const val = event.target.value;
          setQuery(val);
          setIsOpen(true);
          if (val.trim().length < 2) {
            setPredictions([]);
            setActiveIndex(-1);
            setIsLoading(false);
            setError('');
          }
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 150)}
        placeholder="Wyszukaj w Google Maps (miasto, zabytek, lokal)..."
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen && predictions.length > 0}
        aria-controls="google-location-suggestions"
        aria-autocomplete="list"
        className="w-full rounded-xl border border-white/80 bg-white/95 py-2.5 pl-3.5 pr-16 text-xs font-medium text-slate-800 shadow-lg outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
      />

      <div className="absolute right-2 flex items-center gap-0.5">
        {query.length > 0 && !isLoading && !isResolving && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setPredictions([]);
              setError('');
              inputRef.current?.focus();
            }}
            title="Wyczyść"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="submit"
          title="Szukaj w Google Maps"
          aria-label="Szukaj lokalizacji"
          disabled={isLoading || isResolving || query.trim().length < 2}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLoading || isResolving ? (
            <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </button>
      </div>

      {isOpen && (predictions.length > 0 || isLoading || error) && (
        <div
          id="google-location-suggestions"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        >
          {isLoading && predictions.length === 0 && (
            <div className="flex items-center gap-2 px-3.5 py-3 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
              <span>Szukanie w Google Maps...</span>
            </div>
          )}

          {error && (
            <p className="px-3.5 py-2.5 text-xs text-rose-600">{error}</p>
          )}

          {!error &&
            predictions.map((item, idx) => {
              const isRegion = isRegionOrCityTypes(item.types);
              const badge = isRegion
                ? 'Miasto / Region'
                : extractPolishTags(item.types)[0] || 'Obiekt';
              const isHighlighted = idx === activeIndex;

              return (
                <button
                  key={item.placeId}
                  type="button"
                  role="option"
                  aria-selected={isHighlighted}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => void handleSelectPrediction(item)}
                  className={`flex w-full items-start gap-2.5 border-b border-slate-100 px-3.5 py-2.5 text-left transition-colors last:border-0 ${
                    isHighlighted ? 'bg-indigo-50/80' : 'hover:bg-slate-50'
                  }`}
                >
                  <div
                    className={`mt-0.5 rounded-lg p-1.5 ${
                      isRegion
                        ? 'bg-amber-50 text-amber-600'
                        : 'bg-indigo-50 text-indigo-600'
                    }`}
                  >
                    {isRegion ? (
                      <Compass className="h-3.5 w-3.5" />
                    ) : (
                      <MapPin className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-bold text-slate-800">
                        {item.mainText}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                          isRegion
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {badge}
                      </span>
                    </div>
                    {item.secondaryText && (
                      <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                        {item.secondaryText}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
        </div>
      )}
    </form>
  );
};
