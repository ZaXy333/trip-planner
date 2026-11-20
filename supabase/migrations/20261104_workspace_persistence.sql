-- Additive migration for the existing Trip Planner schema.
-- Run in Supabase SQL Editor after the initial Gemini schema.

ALTER TABLE public.trip_sets
  ADD COLUMN IF NOT EXISTS client_id TEXT;

ALTER TABLE public.places
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS rating NUMERIC(2, 1),
  ADD COLUMN IF NOT EXISTS user_ratings_total INTEGER,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE public.trip_entries
  ADD COLUMN IF NOT EXISTS client_id TEXT;

ALTER TABLE public.saved_folders
  ADD COLUMN IF NOT EXISTS client_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS trip_sets_user_client_id_uidx
  ON public.trip_sets (user_id, client_id);
CREATE UNIQUE INDEX IF NOT EXISTS places_user_source_external_uidx
  ON public.places (user_id, source, source_place_id);
CREATE UNIQUE INDEX IF NOT EXISTS trip_entries_user_client_id_uidx
  ON public.trip_entries (user_id, client_id);
CREATE UNIQUE INDEX IF NOT EXISTS saved_folders_user_client_id_uidx
  ON public.saved_folders (user_id, client_id);
CREATE UNIQUE INDEX IF NOT EXISTS trip_sets_user_id_id_uidx
  ON public.trip_sets (user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS places_user_id_id_uidx
  ON public.places (user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS saved_places_user_place_uidx
  ON public.saved_places (user_id, place_id);

CREATE INDEX IF NOT EXISTS trip_entries_user_set_position_idx
  ON public.trip_entries (user_id, trip_set_id, position);
CREATE INDEX IF NOT EXISTS trip_routes_user_set_day_idx
  ON public.trip_routes (user_id, trip_set_id, day_number);
CREATE INDEX IF NOT EXISTS saved_places_user_idx
  ON public.saved_places (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS search_history_user_created_idx
  ON public.search_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recommendation_searches_user_created_idx
  ON public.recommendation_searches (user_id, created_at DESC);

UPDATE public.user_settings
SET theme = CASE WHEN theme IN ('light', 'dark') THEN theme ELSE 'light' END,
    day_view = CASE WHEN day_view IN ('tabs', 'timeline') THEN day_view ELSE 'tabs' END,
    map_style = CASE WHEN map_style IN ('standard', 'satellite') THEN map_style ELSE 'standard' END,
    travel_mode = CASE
      WHEN UPPER(travel_mode) IN ('WALKING', 'DRIVING') THEN UPPER(travel_mode)
      ELSE 'WALKING'
    END;

ALTER TABLE public.user_settings
  ALTER COLUMN theme SET DEFAULT 'light',
  ALTER COLUMN day_view SET DEFAULT 'tabs',
  ALTER COLUMN map_style SET DEFAULT 'standard',
  ALTER COLUMN travel_mode SET DEFAULT 'WALKING';

-- Keep each child row owned by the same user as its parent. NOT VALID avoids
-- blocking this migration if old rows need cleanup; new writes are still checked.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trip_entries_owner_set_fk'
  ) THEN
    ALTER TABLE public.trip_entries
      ADD CONSTRAINT trip_entries_owner_set_fk
      FOREIGN KEY (user_id, trip_set_id)
      REFERENCES public.trip_sets (user_id, id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trip_entries_owner_place_fk'
  ) THEN
    ALTER TABLE public.trip_entries
      ADD CONSTRAINT trip_entries_owner_place_fk
      FOREIGN KEY (user_id, place_id)
      REFERENCES public.places (user_id, id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trip_routes_owner_set_fk'
  ) THEN
    ALTER TABLE public.trip_routes
      ADD CONSTRAINT trip_routes_owner_set_fk
      FOREIGN KEY (user_id, trip_set_id)
      REFERENCES public.trip_sets (user_id, id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'saved_places_owner_place_fk'
  ) THEN
    ALTER TABLE public.saved_places
      ADD CONSTRAINT saved_places_owner_place_fk
      FOREIGN KEY (user_id, place_id)
      REFERENCES public.places (user_id, id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trip_entries_valid_payload_check'
  ) THEN
    ALTER TABLE public.trip_entries
      ADD CONSTRAINT trip_entries_valid_payload_check
      CHECK (
        (entry_type = 'place' AND place_id IS NOT NULL)
        OR (entry_type = 'day_break' AND place_id IS NULL)
      )
      NOT VALID;
  END IF;
END $$;

-- A folder relation must belong to both the current user's folder and saved place.
DROP POLICY IF EXISTS "Users can manage their folder relationships"
  ON public.saved_folder_places;
CREATE POLICY "Users can manage their folder relationships"
  ON public.saved_folder_places
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.saved_folders f
      WHERE f.id = folder_id AND f.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.saved_places sp
      WHERE sp.id = saved_place_id AND sp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.saved_folders f
      WHERE f.id = folder_id AND f.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.saved_places sp
      WHERE sp.id = saved_place_id AND sp.user_id = auth.uid()
    )
  );
