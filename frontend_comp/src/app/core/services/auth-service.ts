import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, finalize, map, of, shareReplay, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CategorieInvestisseur, TypeCompte, User, UserRole } from '../models/models';
import { MockData } from './mock-data';

/** Réponse de `POST /auth/login` — une étape MFA reste à franchir. */
interface LoginResponse {
  mfaRequired: boolean;
  challengeId: string;
  expiresIn: number;
  /** Numéro de téléphone masqué où le code a été envoyé (absent si non renseigné). */
  phoneHint?: string;
}

/** Réponse de `POST /auth/mfa/verify` et `POST /auth/refresh`. */
interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: BackendUser;
}

/** Profil utilisateur tel que renvoyé par le backend. */
interface BackendUser {
  id: string;
  nom: string;
  prenom?: string;
  email: string;
  role: UserRole;
  statut: string;
  compteTitres?: string;
  compteEspeces?: string;
  solde?: number;
  categorie?: string;
  typeCompte?: string;
  telephone?: string;
  mustChangePassword?: boolean;
  /** Vrai si l'utilisateur participe à un compte-titres à plusieurs signataires. */
  compteJoint?: boolean;
}

/**
 * Service d'authentification — source de vérité de la session côté frontend.
 *
 * Sécurité :
 *  - le jeton d'accès (court) est conservé **en mémoire** uniquement (non
 *    exposé au stockage persistant, donc hors de portée d'une lecture XSS du
 *    `localStorage`) ;
 *  - le jeton de rafraîchissement est gardé en `sessionStorage` (effacé à la
 *    fermeture de l'onglet) — compromis raisonnable pour réhydrater la session ;
 *  - les jetons ne sont jamais journalisés.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly mock = inject(MockData);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly api = environment.apiBaseUrl;

  /** Jeton d'accès courant (mémoire volatile). */
  private accessToken: string | null = null;
  /**
   * Vrai quand une session est (ou a été) établie. Le jeton de rafraîchissement
   * vit désormais dans un cookie HttpOnly inaccessible au JS : on ne peut donc
   * pas le lire, mais ce drapeau indique s'il est pertinent de tenter un refresh.
   */
  private sessionActive = false;
  /** Rafraîchissement en cours partagé — évite les appels concurrents. */
  private refreshInFlight: Observable<string> | null = null;

  /** Défi MFA en attente entre l'étape login et l'étape de vérification OTP. */
  readonly pendingChallenge = signal<{ challengeId: string; returnUrl: string; phoneHint?: string } | null>(null);

  // ───────────────────────────── Connexion ─────────────────────────────────

  /** Étape 1 — vérifie e-mail + mot de passe et ouvre un défi MFA. */
  login(email: string, password: string, returnUrl = '/'): Observable<void> {
    return this.http
      .post<LoginResponse>(`${this.api}/auth/login`, { email: email.trim(), password })
      .pipe(
        tap((res) => this.pendingChallenge.set({
          challengeId: res.challengeId, returnUrl, phoneHint: res.phoneHint,
        })),
        map(() => void 0),
      );
  }

  /** Étape 2 — vérifie le code OTP et établit la session. Renvoie l'URL de redirection. */
  verifyMfa(code: string): Observable<string> {
    const pending = this.pendingChallenge();
    if (!pending) {
      return throwError(() => new Error('Aucune authentification en cours.'));
    }
    return this.http
      .post<AuthResponse>(`${this.api}/auth/mfa/verify`, {
        challengeId: pending.challengeId,
        code,
      })
      .pipe(
        map((res) => {
          this.storeTokens(res);
          const user = this.applyUser(this.mapUser(res.user));
          this.pendingChallenge.set(null);
          // Premiere connexion : on impose le changement du mot de passe initial.
          if (user.mustChangePassword) {
            return '/auth/change-password';
          }
          return pending.returnUrl && pending.returnUrl !== '/'
            ? pending.returnUrl
            : this.redirectFor(user.role);
        }),
      );
  }

  /**
   * Change le mot de passe de l'utilisateur connecté (1re connexion ou volontaire).
   *
   * Le backend révoque les sessions et le jeton d'accès courant porte encore le
   * drapeau « mot de passe à changer » : on purge donc la session locale pour
   * forcer une reconnexion propre avec le nouveau mot de passe.
   */
  changePassword(currentPassword: string | undefined, newPassword: string): Observable<void> {
    // En 1re connexion, `currentPassword` est omis : le backend n'exige pas le
    // mot de passe provisoire (l'utilisateur vient de s'authentifier avec).
    const body = currentPassword ? { currentPassword, newPassword } : { newPassword };
    return this.http
      .post(`${this.api}/auth/change-password`, body)
      .pipe(
        tap(() => this.clearSession()),
        map(() => void 0),
      );
  }

  /** Demande un lien de réinitialisation de mot de passe (self-service). Le
   *  backend répond toujours de façon générique (anti-énumération de comptes). */
  forgotPassword(email: string): Observable<void> {
    return this.http
      .post(`${this.api}/auth/forgot-password`, { email: email.trim() })
      .pipe(map(() => void 0));
  }

  /** Définit un nouveau mot de passe à partir d'un jeton reçu par e-mail. */
  resetPassword(token: string, newPassword: string): Observable<void> {
    return this.http
      .post(`${this.api}/auth/reset-password`, { token, newPassword })
      .pipe(map(() => void 0));
  }

  /** Annule un défi MFA en attente (retour à l'écran de connexion). */
  cancelPending(): void {
    this.pendingChallenge.set(null);
  }

  /** Envoie un OTP d'action (step-up) à l'utilisateur connecté pour confirmer
   *  une opération sensible (soumission / annulation / modification d'ordre).
   *  Renvoie l'identifiant de défi à présenter ensuite à `verifyActionOtp`. */
  sendActionOtp(): Observable<{ challengeId: string; expiresIn: number }> {
    return this.http.post<{ challengeId: string; expiresIn: number }>(
      `${this.api}/auth/otp/send`, {});
  }

  /** Vérifie le code OTP d'action. Réussit (200) si le code est correct. */
  verifyActionOtp(challengeId: string, code: string): Observable<void> {
    return this.http
      .post(`${this.api}/auth/otp/verify`, { challengeId, code })
      .pipe(map(() => void 0));
  }

  // ──────────────────────── Rafraîchissement / session ─────────────────────

  /**
   * Échange le jeton de rafraîchissement (cookie HttpOnly, envoyé automatiquement
   * par le navigateur sur l'origine de l'app) contre un nouveau jeton d'accès.
   */
  refresh(): Observable<string> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.http
      .post<AuthResponse>(`${this.api}/auth/refresh`, {})
      .pipe(
        tap((res) => {
          this.storeTokens(res);
          this.applyUser(this.mapUser(res.user));
        }),
        map((res) => res.accessToken),
        shareReplay(1),
        finalize(() => {
          this.refreshInFlight = null;
        }),
      );
    return this.refreshInFlight;
  }

  /** Tente de réhydrater la session au démarrage (après un rechargement de page). */
  restoreSession(): Observable<boolean> {
    if (!this.isBrowser) {
      return of(false);
    }
    // Le cookie HttpOnly n'est pas lisible en JS : on tente le refresh, qui
    // échoue proprement (401) en l'absence de session valide.
    return this.refresh().pipe(
      map(() => true),
      catchError(() => {
        this.clearSession();
        return of(false);
      }),
    );
  }

  /** Déconnexion — révoque le jeton côté serveur (cookie) puis purge l'état local. */
  logout(): Observable<void> {
    if (!this.accessToken) {
      this.clearSession();
      return of(void 0);
    }
    return this.http.post(`${this.api}/auth/logout`, {}).pipe(
      map(() => void 0),
      // La déconnexion locale doit aboutir même si l'appel serveur échoue.
      catchError(() => of(void 0)),
      tap(() => this.clearSession()),
    );
  }

  // ─────────────────────────────── Accès jetons ────────────────────────────

  getAccessToken(): string | null {
    return this.accessToken;
  }

  /** Vrai si une session est active (jeton de rafraîchissement présumé présent). */
  hasRefreshToken(): boolean {
    return this.sessionActive;
  }

  /** Détermine la page d'accueil selon le rôle (cohérent avec les guards RBAC). */
  redirectFor(role: UserRole): string {
    if (role === 'CLIENT_PP' || role === 'CLIENT_PM') return '/client/dashboard';
    return '/backoffice/dashboard';
  }

  /** Traduit une erreur HTTP en message générique (sans aucun détail technique). */
  errorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Service indisponible. Vérifiez votre connexion réseau.';
      if (err.status === 400 || err.status === 422) return 'Informations invalides. Vérifiez votre saisie.';
      if (err.status === 401) return 'Identifiants incorrects.';
      if (err.status === 403) return "Vous n'êtes pas autorisé à effectuer cette action.";
      if (err.status === 404) return 'Élément introuvable.';
      if (err.status === 429) return 'Trop de tentatives. Réessayez dans quelques minutes.';
      if (err.status >= 500) return 'Le service rencontre un problème. Réessayez plus tard.';
    }
    return 'Une erreur est survenue. Réessayez.';
  }

  // ─────────────────────────────── Privé ───────────────────────────────────

  private storeTokens(res: AuthResponse): void {
    this.accessToken = res.accessToken;
    // Le jeton de rafraîchissement est géré par le cookie HttpOnly côté serveur.
    this.sessionActive = true;
  }

  /** Propage l'utilisateur authentifié dans l'état applicatif (guards, UI)
   *  puis recharge les données métier visibles selon le rôle. */
  private applyUser(user: User): User {
    this.mock.currentUser.update((prev) => ({ ...prev, ...user }));
    this.mock.isAuthenticated.set(true);

    // Hydratation des données dépendant de la session. On ne déclenche que les
    // appels autorisés pour le rôle courant, afin d'éviter des 403/404 inutiles
    // (le backend reste la source de vérité du cloisonnement).
    const isClient = user.role === 'CLIENT_PP' || user.role === 'CLIENT_PM';

    this.mock.refreshEmissions();
    this.mock.refreshMarcheConfig();
    this.mock.refreshOrders();
    this.mock.refreshNotifications();
    this.mock.refreshDocuments();
    this.mock.refreshPermissions();

    // Réservé à l'administrateur (permission AUDIT_READ).
    if (this.mock.hasPermission('AUDIT_READ')) this.mock.refreshAudit();
    // Réservé au back-office gérant les clients (permission CLIENT_MANAGE).
    if (this.mock.hasPermission('CLIENT_MANAGE')) this.mock.refreshClients();
    // Données propres au client connecté (portefeuille + dossier).
    if (isClient) {
      this.mock.refreshPositions();
      this.mock.refreshMyCompte();
    }
    return user;
  }

  private clearSession(): void {
    this.accessToken = null;
    this.sessionActive = false;
    this.pendingChallenge.set(null);
    this.mock.isAuthenticated.set(false);
  }

  private mapUser(b: BackendUser): User {
    return {
      id: b.id,
      nom: b.nom,
      prenom: b.prenom,
      email: b.email,
      role: b.role,
      compteTitres: b.compteTitres,
      compteEspeces: b.compteEspeces,
      solde: b.solde,
      categorie: b.categorie as CategorieInvestisseur | undefined,
      typeCompte: b.typeCompte as TypeCompte | undefined,
      telephone: b.telephone,
      mustChangePassword: b.mustChangePassword,
      compteJoint: b.compteJoint ?? false,
    };
  }

}
