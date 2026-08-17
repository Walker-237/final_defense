import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { IdleService } from './idle';
import { AuthService } from './auth-service';

const TIMEOUT_MS = 15 * 60 * 1000;
const WARN_BEFORE_MS = 60 * 1000;
/** Instant où l'avertissement apparaît. */
const WARN_AT = TIMEOUT_MS - WARN_BEFORE_MS;

function setup() {
  const logout = vi.fn(() => of(void 0));
  const navigate = vi.fn(() => Promise.resolve(true));

  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { logout } },
      { provide: Router, useValue: { navigate } },
    ],
  });

  return { svc: TestBed.inject(IdleService), logout, navigate };
}

describe('IdleService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('démarre sans avertissement', () => {
    const { svc } = setup();
    expect(svc.warningActive()).toBe(false);
    expect(svc.secondsLeft()).toBe(60);
  });

  it('affiche l’avertissement 60 s avant l’expiration', () => {
    const { svc } = setup();
    svc.start();

    vi.advanceTimersByTime(WARN_AT - 1);
    expect(svc.warningActive()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(svc.warningActive()).toBe(true);
    expect(svc.secondsLeft()).toBe(60);
  });

  it('décrémente le compte à rebours chaque seconde', () => {
    const { svc } = setup();
    svc.start();
    vi.advanceTimersByTime(WARN_AT);

    vi.advanceTimersByTime(1000);
    expect(svc.secondsLeft()).toBe(59);
    vi.advanceTimersByTime(5000);
    expect(svc.secondsLeft()).toBe(54);
  });

  it('déconnecte et redirige à l’expiration totale', () => {
    const { svc, logout, navigate } = setup();
    svc.start();

    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(logout).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/auth/login'], { queryParams: { reason: 'idle' } });
  });

  it('ne déconnecte qu’une seule fois (compte à rebours + timer global)', () => {
    const { svc, logout } = setup();
    svc.start();

    vi.advanceTimersByTime(TIMEOUT_MS + 5000);
    expect(logout).toHaveBeenCalledOnce();
  });

  it('une activité utilisateur réarme le minuteur', () => {
    const { svc, logout } = setup();
    svc.start();

    vi.advanceTimersByTime(WARN_AT - 1000);
    window.dispatchEvent(new Event('mousemove'));

    // Sans réarmement, l'avertissement serait apparu 1 s plus tard.
    vi.advanceTimersByTime(2000);
    expect(svc.warningActive()).toBe(false);

    // Le compteur est reparti de zéro : rien ne se déclenche avant TIMEOUT_MS
    // décompté DEPUIS l'activité (soit 2 000 ms déjà écoulées).
    vi.advanceTimersByTime(TIMEOUT_MS - 2000 - 1);
    expect(logout).not.toHaveBeenCalled();

    // ...et la déconnexion survient bien à l'échéance réarmée.
    vi.advanceTimersByTime(1);
    expect(logout).toHaveBeenCalledOnce();
  });

  it('une activité pendant l’avertissement le masque', () => {
    const { svc } = setup();
    svc.start();
    vi.advanceTimersByTime(WARN_AT);
    expect(svc.warningActive()).toBe(true);

    window.dispatchEvent(new Event('keydown'));
    expect(svc.warningActive()).toBe(false);
  });

  it('continueSession() réarme le minuteur et masque l’avertissement', () => {
    const { svc, logout } = setup();
    svc.start();
    vi.advanceTimersByTime(WARN_AT);
    expect(svc.warningActive()).toBe(true);

    svc.continueSession();
    expect(svc.warningActive()).toBe(false);

    vi.advanceTimersByTime(WARN_AT - 1);
    expect(logout).not.toHaveBeenCalled();
  });

  it('stop() désarme tout et ignore l’activité ultérieure', () => {
    const { svc, logout } = setup();
    svc.start();
    svc.stop();

    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    expect(logout).not.toHaveBeenCalled();
    expect(svc.warningActive()).toBe(false);
  });

  it('après stop(), les écouteurs sont retirés', () => {
    const { svc } = setup();
    svc.start();
    vi.advanceTimersByTime(WARN_AT);
    svc.stop();

    // L'activité ne doit plus rien réarmer (aucun minuteur actif).
    window.dispatchEvent(new Event('click'));
    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    expect(svc.warningActive()).toBe(false);
  });

  it('ngOnDestroy() arrête la surveillance', () => {
    const { svc, logout } = setup();
    svc.start();
    svc.ngOnDestroy();

    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    expect(logout).not.toHaveBeenCalled();
  });

  it('la déconnexion arrête aussi la surveillance', () => {
    const { svc, logout } = setup();
    svc.start();
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(logout).toHaveBeenCalledOnce();

    // Plus aucun minuteur : une nouvelle période ne redéclenche rien.
    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    expect(logout).toHaveBeenCalledOnce();
  });
});
