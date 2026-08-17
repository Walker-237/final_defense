/**
 * Configuration d'environnement du frontend.
 *
 * `apiBaseUrl` est **relatif** : les appels partent vers la même origine que
 * l'application puis sont relayés vers le backend Axum par un proxy
 * (`proxy.conf.json` en dev `ng serve`, middleware `/api` dans `server.ts` en
 * SSR). Cela permet de conserver une CSP stricte `connect-src 'self'` et
 * d'éliminer le CORS — le navigateur ne dialogue qu'avec sa propre origine.
 */
export const environment = {
  production: false,
  apiBaseUrl: '/api/v1',
};
