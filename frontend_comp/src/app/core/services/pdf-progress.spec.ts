import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PdfProgressService, PdfProgressOverlay } from './pdf-progress';

describe('PdfProgressService', () => {
  let svc: PdfProgressService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    svc = TestBed.inject(PdfProgressService);
  });
  afterEach(() => vi.useRealTimers());

  it('est inactif au départ', () => {
    expect(svc.active()).toBe(false);
    expect(svc.percent()).toBe(0);
    expect(svc.label()).toBe('');
  });

  it('start() active l’overlay à 5 % avec le libellé par défaut', () => {
    svc.start();
    expect(svc.active()).toBe(true);
    expect(svc.percent()).toBe(5);
    expect(svc.label()).toBe('Préparation…');
  });

  it('start() accepte un libellé personnalisé', () => {
    svc.start('Rendu…');
    expect(svc.label()).toBe('Rendu…');
  });

  it('set() met à jour le pourcentage et le libellé', () => {
    svc.start();
    svc.set(42, 'Encodage');
    expect(svc.percent()).toBe(42);
    expect(svc.label()).toBe('Encodage');
  });

  it('set() conserve le libellé courant quand aucun n’est fourni', () => {
    svc.start('Initial');
    svc.set(30);
    expect(svc.label()).toBe('Initial');
  });

  it('set() borne le pourcentage dans [0, 100]', () => {
    svc.set(-20);
    expect(svc.percent()).toBe(0);
    svc.set(150);
    expect(svc.percent()).toBe(100);
  });

  it('set() arrondit les pourcentages fractionnaires', () => {
    svc.set(33.6);
    expect(svc.percent()).toBe(34);
  });

  it('done() passe à 100 % puis masque l’overlay après 350 ms', () => {
    svc.start();
    svc.done();
    expect(svc.percent()).toBe(100);
    expect(svc.label()).toBe('Terminé');
    expect(svc.active()).toBe(true);

    vi.advanceTimersByTime(350);
    expect(svc.active()).toBe(false);
  });

  it('fail() masque immédiatement l’overlay', () => {
    svc.start();
    svc.fail();
    expect(svc.active()).toBe(false);
  });
});

describe('PdfProgressOverlay', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [PdfProgressOverlay] });
  });

  it('ne rend rien tant que le service est inactif', () => {
    const fixture = TestBed.createComponent(PdfProgressOverlay);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="status"]')).toBeNull();
  });

  it('affiche le libellé et le pourcentage quand actif', () => {
    const fixture = TestBed.createComponent(PdfProgressOverlay);
    const svc = TestBed.inject(PdfProgressService);
    svc.start('Rendu…');
    svc.set(60, 'Encodage');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="status"]')).not.toBeNull();
    expect(el.textContent).toContain('Encodage');
    expect(el.textContent).toContain('60%');
  });
});
