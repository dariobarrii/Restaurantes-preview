-- Active card metadata is intentionally public; allow both anonymous and signed-in scanners.
DROP POLICY IF EXISTS "Public can read active cards" ON public.app_business_cards;
DROP POLICY IF EXISTS app_business_cards_public_active_select ON public.app_business_cards;
CREATE POLICY app_business_cards_public_active_select
ON public.app_business_cards
FOR SELECT TO anon, authenticated
USING (status = 'active' AND archived_at IS NULL);
