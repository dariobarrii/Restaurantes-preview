-- Additive compatibility for fields read by the NQ Central dashboard.
-- Existing rows remain NULL; no categories, labels, or historical timestamps are inferred.
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.app_businesses') IS NULL
     OR pg_catalog.to_regclass('public.app_business_cards') IS NULL THEN
    RAISE EXCEPTION 'Required multi-business tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_businesses'
      AND column_name IN ('id','name','slug','status')
    GROUP BY table_name
    HAVING count(*)=4
  ) THEN
    RAISE EXCEPTION 'app_businesses baseline columns do not match the expected staging schema';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_business_cards'
      AND column_name IN ('id','business_id','channel','target_url','status','archived_at')
    GROUP BY table_name
    HAVING count(*)=6
  ) THEN
    RAISE EXCEPTION 'app_business_cards baseline columns do not match the expected staging schema';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND (
      (table_name='app_businesses' AND column_name='category' AND data_type <> 'text')
      OR (table_name='app_business_cards' AND column_name='label' AND data_type <> 'text')
    )
  ) THEN
    RAISE EXCEPTION 'Existing category/label column has an unexpected type';
  END IF;
END
$preflight$;

ALTER TABLE public.app_businesses
  ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.app_business_cards
  ADD COLUMN IF NOT EXISTS label text;

-- An existing column may have been introduced manually as NOT NULL; make the
-- compatibility fields nullable without fabricating legacy values.
ALTER TABLE public.app_businesses ALTER COLUMN category DROP NOT NULL;
ALTER TABLE public.app_business_cards ALTER COLUMN label DROP NOT NULL;

-- Runtime inserts omit these primary keys. Some staging schemas were created
-- without the identity/serial defaults from the baseline migration. Restore an
-- owned sequence default without changing any existing row or timestamp.
DO $business_event_id_defaults$
DECLARE
  v_table_name text;
  v_sequence text;
  v_sequence_name text;
  v_default text;
  v_max_id bigint;
  v_last_value bigint;
  v_is_called boolean;
  v_next_value bigint;
  v_table_oid oid;
  v_table_owner oid;
  v_sequence_owner oid;
  v_identity boolean;
  v_default_uses_sequence boolean;
  v_sequence_min bigint;
  v_sequence_max bigint;
  v_sequence_cycles boolean;
  v_sequence_increment bigint;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'app_business_events','app_business_review_snapshots'
  ] LOOP
    IF pg_catalog.to_regclass('public.' || v_table_name) IS NULL THEN
      RAISE EXCEPTION 'Required table public.% is missing', v_table_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=v_table_name
        AND column_name='id' AND data_type='bigint'
    ) THEN
      RAISE EXCEPTION 'public.% id must be bigint before adding an ID default', v_table_name;
    END IF;

    -- Prevent concurrent INSERTs from allocating IDs while max(id) is aligned.
    EXECUTE pg_catalog.format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', v_table_name);
    SELECT c.oid, c.relowner INTO v_table_oid, v_table_owner
    FROM pg_catalog.pg_class c WHERE c.oid=('public.' || v_table_name)::regclass;
    SELECT is_identity='YES' INTO v_identity
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=v_table_name AND column_name='id';

    v_sequence := pg_catalog.pg_get_serial_sequence(
      'public.' || v_table_name, 'id'
    );
    SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid)
      INTO v_default
    FROM pg_catalog.pg_attrdef d
    JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
    WHERE d.adrelid=('public.' || v_table_name)::regclass
      AND a.attname='id';

    IF v_sequence IS NULL THEN
      IF v_default IS NOT NULL THEN
        RAISE EXCEPTION 'public.%.id has an unmanaged default; inspect before migration', v_table_name;
      END IF;
      v_sequence_name := 'public.' || pg_catalog.quote_ident(v_table_name || '_id_seq');
      IF pg_catalog.to_regclass(v_sequence_name) IS NOT NULL THEN
        RAISE EXCEPTION 'Sequence % already exists without an owned ID default', v_sequence_name;
      END IF;
      EXECUTE pg_catalog.format('CREATE SEQUENCE %s', v_sequence_name);
      EXECUTE pg_catalog.format(
        'ALTER SEQUENCE %s OWNED BY public.%I.id', v_sequence_name, v_table_name
      );
      EXECUTE pg_catalog.format(
        'ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT nextval(%L::regclass)',
        v_table_name, v_sequence_name
      );
      v_sequence := pg_catalog.pg_get_serial_sequence(
        'public.' || v_table_name, 'id'
      );
    END IF;

    IF v_sequence IS NULL THEN
      RAISE EXCEPTION 'Could not establish an owned ID sequence for public.%', v_table_name;
    END IF;

    SELECT c.relowner INTO v_sequence_owner
    FROM pg_catalog.pg_class c WHERE c.oid=v_sequence::regclass;
    IF v_sequence_owner IS DISTINCT FROM v_table_owner THEN
      RAISE EXCEPTION 'public.% ID sequence owner does not match table owner', v_table_name;
    END IF;

    IF NOT COALESCE(v_identity, false) THEN
      -- If the sequence is still owned by this ID column but its DEFAULT was
      -- removed, restore only that missing default. Never replace an existing
      -- expression that points elsewhere; that remains a fail-closed error.
      IF v_default IS NULL THEN
        EXECUTE pg_catalog.format(
          'ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT nextval(%L::regclass)',
          v_table_name, v_sequence
        );
        SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid)
          INTO v_default
        FROM pg_catalog.pg_attrdef d
        JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
        WHERE d.adrelid=v_table_oid AND a.attname='id';
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_depend d
        JOIN pg_catalog.pg_attrdef ad ON ad.oid=d.objid
        WHERE d.classid='pg_catalog.pg_attrdef'::regclass
          AND d.refclassid='pg_catalog.pg_class'::regclass
          AND d.refobjid=v_sequence::regclass
          AND ad.adrelid=v_table_oid
          AND ad.adnum=(SELECT a.attnum FROM pg_catalog.pg_attribute a
                        WHERE a.attrelid=v_table_oid AND a.attname='id' AND NOT a.attisdropped)
      ) INTO v_default_uses_sequence;
      IF v_default IS NULL OR NOT COALESCE(v_default_uses_sequence,false) THEN
        RAISE EXCEPTION 'public.%.id default does not use its owned sequence', v_table_name;
      END IF;
    END IF;

    SELECT seqmin, seqmax, seqcycle, seqincrement
      INTO v_sequence_min, v_sequence_max, v_sequence_cycles, v_sequence_increment
    FROM pg_catalog.pg_sequence WHERE seqrelid=v_sequence::regclass;
    IF v_sequence_increment IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'public.% ID sequence must increment by 1', v_table_name;
    END IF;
    IF v_sequence_cycles THEN
      RAISE EXCEPTION 'public.% ID sequence must not CYCLE', v_table_name;
    END IF;

    -- Staging's postgres default ACL grants sequence access to browser roles.
    -- Do not expose new ID sequences while 021 is still awaiting application.
    -- Server/owner access remains; 021 adds back review-only authenticated USAGE.
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated',
      v_sequence::regclass
    );
    IF pg_catalog.has_sequence_privilege('anon',v_sequence,'USAGE,SELECT,UPDATE')
       OR pg_catalog.has_sequence_privilege('authenticated',v_sequence,'USAGE,SELECT,UPDATE') THEN
      RAISE EXCEPTION 'Unexpected effective browser access to public.% ID sequence', v_table_name;
    END IF;

    EXECUTE pg_catalog.format(
      'SELECT COALESCE(max(id),0) FROM public.%I', v_table_name
    ) INTO v_max_id;
    EXECUTE pg_catalog.format(
      'SELECT last_value, is_called FROM %s', v_sequence::regclass
    ) INTO v_last_value, v_is_called;
    IF v_max_id = 9223372036854775807
       OR (v_is_called AND v_last_value = 9223372036854775807) THEN
      RAISE EXCEPTION 'public.%.id exhausted bigint sequence values', v_table_name;
    END IF;
    v_next_value := greatest(
      v_max_id + 1,
      CASE WHEN v_is_called THEN v_last_value + 1 ELSE v_last_value END
    );
    IF v_next_value < v_sequence_min OR v_next_value > v_sequence_max THEN
      RAISE EXCEPTION 'public.% ID sequence cannot provide next required value %', v_table_name, v_next_value;
    END IF;
    -- ALTER SEQUENCE RESTART is transactional (unlike setval), so a later
    -- preflight failure cannot leave sequence state changed after rollback.
    EXECUTE pg_catalog.format(
      'ALTER SEQUENCE %s RESTART WITH %s', v_sequence::regclass, v_next_value
    );
  END LOOP;
END
$business_event_id_defaults$;

COMMIT;
