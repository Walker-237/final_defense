import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth-service';

/** Vrai pour les appels d'authentification qui ne doivent jamais être rejoués via refresh. */
function isAuthEndpoint(url: string): boolean {
  return (
    url.includes('/auth/login') ||
    url.includes('/auth/mfa') ||
    url.includes('/auth/refresh')
  );
}

/**
 * Intercepteur HTTP :
 *  - ajoute l'en-tête `Authorization: Bearer` aux appels vers l'API backend ;
 *  - sur une réponse 401, tente **un seul** rafraîchissement de jeton puis
 *    rejoue la requête ; en cas d'échec, purge la session.
 *
 * Le jeton n'est attaché qu'aux requêtes vers `apiBaseUrl` — jamais à un
 * domaine tiers, pour éviter toute fuite de jeton.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const isApi = req.url.startsWith(environment.apiBaseUrl);
  const authCall = isAuthEndpoint(req.url);

  let outgoing = req;
  const token = auth.getAccessToken();
  if (isApi && token && !authCall) {
    outgoing = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }

  return next(outgoing).pipe(
    catchError((err: HttpErrorResponse) => {
      const recoverable = err.status === 401 && isApi && !authCall && auth.hasRefreshToken();
      if (!recoverable) {
        return throwError(() => err);
      }
      return auth.refresh().pipe(
        switchMap((fresh) =>
          next(req.clone({ setHeaders: { Authorization: `Bearer ${fresh}` } })),
        ),
        catchError((refreshErr) => throwError(() => refreshErr)),
      );
    }),
  );
};
