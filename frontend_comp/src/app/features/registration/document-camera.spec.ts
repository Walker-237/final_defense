import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { DocumentCameraComponent } from './document-camera';

/**
 * getUserMedia n'existe pas sous jsdom : on couvre la garde SSR, les messages
 * d'erreur (permission, matériel) et la capture d'une frame.
 */
describe('DocumentCameraComponent', () => {
  function make(platform: 'browser' | 'server') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DocumentCameraComponent],
      providers: [{ provide: PLATFORM_ID, useValue: platform }],
    });
    return TestBed.createComponent(DocumentCameraComponent);
  }

  it('ne démarre pas la caméra côté serveur (SSR)', async () => {
    const f = make('server');
    await f.componentInstance.ngAfterViewInit();
    expect(f.componentInstance.prete()).toBe(false);
    expect(f.componentInstance.erreur()).toBe('');
  });

  it('affiche la vidéo et le repère de cadrage', () => {
    const f = make('server');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('video')).not.toBeNull();
    expect(el.textContent).toContain('Cadrez la pièce');
  });

  it.each([
    ['NotAllowedError', 'Autorisation caméra refusée'],
    ['NotFoundError', 'Aucune caméra détectée'],
    ['NotReadableError', 'déjà utilisée'],
    ['AutreErreur', 'Caméra indisponible'],
  ])('traduit l’échec %s en message actionnable', (name, attendu) => {
    const cmp = make('server').componentInstance;
    const msg = (cmp as any).messageErreur({ name });
    expect(msg).toContain(attendu);
    // Chaque message propose le repli : importer un fichier.
    expect(msg.toLowerCase()).toContain('importez');
  });

  it('capturer() émet l’image de la frame courante', () => {
    const f = make('server');
    const cmp = f.componentInstance;
    const emis = vi.fn();
    cmp.captured.subscribe(emis);

    // Vidéo factice avec une résolution native.
    (cmp as any).videoRef = { nativeElement: { videoWidth: 1920, videoHeight: 1080 } };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage: vi.fn() } as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/jpeg;base64,AAA');

    cmp.capturer();

    expect(emis).toHaveBeenCalledWith('data:image/jpeg;base64,AAA');
    vi.restoreAllMocks();
  });

  it('capturer() ne fait rien tant que la vidéo n’a pas de résolution', () => {
    const cmp = make('server').componentInstance;
    const emis = vi.fn();
    cmp.captured.subscribe(emis);
    (cmp as any).videoRef = { nativeElement: { videoWidth: 0, videoHeight: 0 } };

    cmp.capturer();
    expect(emis).not.toHaveBeenCalled();
  });
});
