import { Injectable, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { AuthService } from './auth-service';

/** Durée totale d'inactivité avant déconnexion : 15 minutes. */
const TIMEOUT_MS = 15 * 60 * 1000;
/** Délai d'affichage de l'avertissement avant la déconnexion : 60 secondes. */
const WARN_BEFORE_MS = 60 * 1000;

const EVENTS: ReadonlyArray<string> = [
  'mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click',
];

/**
 * Service de détection d'inactivité — déconnecte automatiquement l'utilisateur
 * après 5 minutes sans interaction, avec un avertissement à 60 secondes.
 *
 * Cycle de vie : appeler `start()` à l'entrée de la zone authentifiée,
 * `stop()` à la sortie (ngOnDestroy du layout).
 */
@Injectable({ providedIn: 'root' })
export class IdleService implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Vrai quand la fenêtre d'avertissement est visible. */
  readonly warningActive = signal(false);
  /** Secondes restantes affichées dans l'avertissement. */
  readonly secondsLeft = signal(WARN_BEFORE_MS / 1000);

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private warnTimer: ReturnType<typeof setTimeout> | null = null;
  private countdown: ReturnType<typeof setInterval> | null = null;
  private loggingOut = false;

  private readonly onActivity = (): void => { this.reset(); };

  /** Lance la surveillance d'inactivité (à appeler dès que l'utilisateur est connecté). */
  start(): void {
    if (!this.isBrowser) return;
    for (const ev of EVENTS) {
      window.addEventListener(ev, this.onActivity, { passive: true, capture: true });
    }
    this.reset();
  }

  /** Arrête la surveillance (ngOnDestroy du layout). */
  stop(): void {
    if (!this.isBrowser) return;
    for (const ev of EVENTS) {
      window.removeEventListener(ev, this.onActivity, { capture: true });
    }
    this.clearTimers();
    this.warningActive.set(false);
  }

  /** Réinitialise le compteur d'inactivité (bouton "Continuer"). */
  continueSession(): void {
    this.loggingOut = false;
    this.reset();
  }

  ngOnDestroy(): void {
    this.stop();
  }

  // ─────────────────────────── Privé ───────────────────────────────────────

  private reset(): void {
    this.clearTimers();
    this.warningActive.set(false);
    this.loggingOut = false;

    // Avertissement affiché (TIMEOUT_MS - WARN_BEFORE_MS) après la dernière activité
    this.warnTimer = setTimeout(() => {
      this.warningActive.set(true);
      this.secondsLeft.set(WARN_BEFORE_MS / 1000);

      this.countdown = setInterval(() => {
        const s = this.secondsLeft() - 1;
        this.secondsLeft.set(s);
        if (s <= 0) this.doLogout();
      }, 1000);
    }, TIMEOUT_MS - WARN_BEFORE_MS);

    // Déconnexion forcée à l'expiration totale
    this.idleTimer = setTimeout(() => this.doLogout(), TIMEOUT_MS);
  }

  private doLogout(): void {
    if (this.loggingOut) return;
    this.loggingOut = true;
    this.stop();
    this.auth.logout().subscribe(() =>
      this.router.navigate(['/auth/login'], { queryParams: { reason: 'idle' } })
    );
  }

  private clearTimers(): void {
    if (this.idleTimer)  { clearTimeout(this.idleTimer);   this.idleTimer = null; }
    if (this.warnTimer)  { clearTimeout(this.warnTimer);   this.warnTimer = null; }
    if (this.countdown)  { clearInterval(this.countdown);  this.countdown = null; }
  }
}
