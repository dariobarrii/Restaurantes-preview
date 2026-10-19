// Staging-only public configuration. Fill from the isolated staging deployment.
 // Keep secrets out of this file; the browser receives only the staging URL, publishable key, and gateway URL.
window.NQ_CENTRAL_STAGING_CONFIG = Object.freeze({
  supabaseUrl: "",
  publishableKey: "",
  eventGatewayUrl: ""
});
