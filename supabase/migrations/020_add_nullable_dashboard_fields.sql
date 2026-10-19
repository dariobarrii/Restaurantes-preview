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

    EXECUTE pg_catalog.format(
      'SELECT COALESCE(max(id),0) FROM public.%I', v_table_name
    ) INTO v_max_id;
    EXECUTE pg_catalog.format(
      'SELECT last_value, is_called FROM %s', v_sequence::regclass
    ) INTO v_last_value, v_is_called;
    IF greatest(
      v_max_id,
      CASE WHEN v_is_called THEN v_last_value ELSE v_last_value - 1 END
    ) = 9223372036854775807 THEN
      RAISE EXCEPTION 'public.%.id exhausted bigint sequence values', v_table_name;
    END IF;
    v_next_value := greatest(
      v_max_id,
      CASE WHEN v_is_called THEN v_last_value ELSE v_last_value - 1 END
    ) + 1;
    PERFORM pg_catalog.setval(v_sequence::regclass, v_next_value, false);
  END LOOP;
END
$business_event_id_defaults$;

COMMIT;
