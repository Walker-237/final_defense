import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ToastService, ToastContainer, ToastType } from './toast';

describe('ToastService', () => {
  let svc: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    svc = TestBed.inject(ToastService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('démarre avec une liste vide', () => {
    expect(svc.list()).toEqual([]);
  });

  it('show() empile un toast avec type, titre et message', () => {
    svc.show('info', 'Titre', 'Message');
    expect(svc.list()).toHaveLength(1);
    expect(svc.list()[0]).toMatchObject({ type: 'info', title: 'Titre', message: 'Message' });
  });

  it('attribue des identifiants croissants et uniques', () => {
    svc.show('info', 'A');
    svc.show('info', 'B');
    const [a, b] = svc.list();
    expect(b.id).toBeGreaterThan(a.id);
  });

  it.each<[keyof ToastService & ('success' | 'info' | 'warn' | 'error'), ToastType]>([
    ['success', 'success'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
  ])('%s() crée un toast de type %s', (method, type) => {
    svc[method]('Titre', 'Msg');
    expect(svc.list()[0]).toMatchObject({ type, title: 'Titre', message: 'Msg' });
  });

  it('dismiss() retire uniquement le toast ciblé', () => {
    svc.show('info', 'A');
    svc.show('info', 'B');
    const [a] = svc.list();
    svc.dismiss(a.id);
    expect(svc.list()).toHaveLength(1);
    expect(svc.list()[0].title).toBe('B');
  });

  it('dismiss() sur un id inconnu est sans effet', () => {
    svc.show('info', 'A');
    svc.dismiss(9999);
    expect(svc.list()).toHaveLength(1);
  });

  it('un toast expire automatiquement après 4,5 s', () => {
    svc.show('info', 'A');
    expect(svc.list()).toHaveLength(1);
    vi.advanceTimersByTime(4500);
    expect(svc.list()).toHaveLength(0);
  });

  it('le toast est encore présent juste avant l’expiration', () => {
    svc.show('info', 'A');
    vi.advanceTimersByTime(4499);
    expect(svc.list()).toHaveLength(1);
  });
});

describe('ToastContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ imports: [ToastContainer] });
  });
  afterEach(() => vi.useRealTimers());

  it('n’affiche aucun toast quand la liste est vide', () => {
    const fixture = TestBed.createComponent(ToastContainer);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent?.trim()).toBe('');
  });

  it('affiche le titre et le message des toasts empilés', () => {
    const fixture = TestBed.createComponent(ToastContainer);
    const svc = TestBed.inject(ToastService);
    svc.error('Échec', 'Détail erreur');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Échec');
    expect(el.textContent).toContain('Détail erreur');
  });

  it('le bouton Fermer retire le toast', () => {
    const fixture = TestBed.createComponent(ToastContainer);
    const svc = TestBed.inject(ToastService);
    svc.info('À fermer');
    fixture.detectChanges();

    const btn = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('button[aria-label="Fermer"]')!;
    btn.click();
    fixture.detectChanges();

    expect(svc.list()).toHaveLength(0);
  });
});
