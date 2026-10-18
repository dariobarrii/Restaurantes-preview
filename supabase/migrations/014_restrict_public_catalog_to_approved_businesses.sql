-- Public catalog only exposes approved businesses and their active, unarchived cards.
DROP POLICY IF EXISTS "Public can read business names" ON public.app_businesses;
DROP POLICY IF EXISTS app_businesses_public_approved_select ON public.app_businesses;
CREATE POLICY app_businesses_public_approved_select
ON public.app_businesses
FOR SELECT TO anon, authenticated
USING (status = 'approved');

DROP POLICY IF EXISTS app_business_cards_public_active_select ON public.app_business_cards;
CREATE POLICY app_business_cards_public_active_select
ON public.app_business_cards
FOR SELECT TO anon, authenticated
USING (
  status = 'active'
  AND archived_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.app_businesses b
    WHERE b.id = app_business_cards.business_id
      AND b.status = 'approved'
  )
);
