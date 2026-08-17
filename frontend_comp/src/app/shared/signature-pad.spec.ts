import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import {
  SignaturePadComponent,
  SignatureDialog,
  SignatureField,
  SignatureViewer,
} from './signature-pad';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

/** Contexte 2D factice : jsdom n'implémente pas le canvas. */
function makeFakeCtx() {
  return {
    strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    clearRect: vi.fn(), drawImage: vi.fn(), putImageData: vi.fn(),
    getImageData: vi.fn(() => ({ id: Math.trunc(performance.now() * 1000) } as unknown as ImageData)),
  };
}

let fakeCtx: ReturnType<typeof makeFakeCtx>;

beforeEach(() => {
  TestBed.resetTestingModule();
  fakeCtx = makeFakeCtx();

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(fakeCtx as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG_DATA_URL);

  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = vi.fn();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount<T>(cmp: new (...a: any[]) => T, inputs: Partial<T> = {}) {
  TestBed.configureTestingModule({ imports: [cmp as any] });
  const fixture = TestBed.createComponent(cmp);
  Object.assign(fixture.componentInstance as object, inputs);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

/** Les @Input classiques ne notifient pas le mode zoneless : on marque la vue. */
function refresh(fixture: ComponentFixture<unknown>) {
  fixture.componentRef.changeDetectorRef.markForCheck();
  fixture.detectChanges();
}

function mouse(x: number, y: number): MouseEvent {
  return { clientX: x, clientY: y } as MouseEvent;
}
function touch(x: number, y: number): TouchEvent {
  return {
    touches: [{ clientX: x, clientY: y }],
    preventDefault: vi.fn(),
  } as unknown as TouchEvent;
}

// ─── SignaturePadComponent ───────────────────────────────────────────────────

describe('SignaturePadComponent', () => {
  it('démarre vide, sans trait ni annulation possible', () => {
    const { cmp, el } = mount(SignaturePadComponent);
    expect(cmp.hasSignature()).toBe(false);
    expect(cmp.strokeCount()).toBe(0);
    expect(cmp.canUndo()).toBe(false);
    expect(el.textContent).toContain('Signez ici');
  });

  it('applique la couleur initiale du stylo', () => {
    const { cmp } = mount(SignaturePadComponent, { penColorInit: '#c8102e' });
    expect(cmp.penColor).toBe('#c8102e');
  });

  it('updatePen() reporte couleur et épaisseur sur le contexte', () => {
    const { cmp } = mount(SignaturePadComponent);
    cmp.penColor = '#1e40af';
    cmp.penWidth = 3;
    cmp.updatePen();
    expect(fakeCtx.strokeStyle).toBe('#1e40af');
    expect(fakeCtx.lineWidth).toBe(3);
    expect(fakeCtx.lineCap).toBe('round');
  });

  it('un tracé souris complet enregistre un trait et émet la signature', () => {
    const { fixture, cmp } = mount(SignaturePadComponent);
    const signed = vi.fn();
    cmp.signed.subscribe(signed);

    cmp.startDraw(mouse(10, 10));
    cmp.draw(mouse(20, 20));
    cmp.endDraw();
    refresh(fixture);

    expect(fakeCtx.beginPath).toHaveBeenCalled();
    expect(fakeCtx.lineTo).toHaveBeenCalled();
    expect(fakeCtx.stroke).toHaveBeenCalled();
    expect(cmp.hasSignature()).toBe(true);
    expect(cmp.strokeCount()).toBe(1);
    expect(cmp.canUndo()).toBe(true);
    expect(signed).toHaveBeenCalledWith(PNG_DATA_URL);
  });

  it('draw() sans startDraw() ne trace rien', () => {
    const { cmp } = mount(SignaturePadComponent);
    cmp.draw(mouse(5, 5));
    expect(fakeCtx.lineTo).not.toHaveBeenCalled();
  });

  it('endDraw() sans tracé en cours est sans effet', () => {
    const { cmp } = mount(SignaturePadComponent);
    cmp.endDraw();
    expect(cmp.hasSignature()).toBe(false);
    expect(cmp.strokeCount()).toBe(0);
  });

  it('un tracé tactile empêche le défilement et enregistre un trait', () => {
    const { cmp } = mount(SignaturePadComponent);
    const start = touch(10, 10);
    const move = touch(20, 20);

    cmp.startDrawTouch(start);
    cmp.drawTouch(move);
    cmp.endDraw();

    expect(start.preventDefault).toHaveBeenCalled();
    expect(move.preventDefault).toHaveBeenCalled();
    expect(cmp.strokeCount()).toBe(1);
  });

  it('drawTouch() sans tracé en cours ne trace rien', () => {
    const { cmp } = mount(SignaturePadComponent);
    cmp.drawTouch(touch(5, 5));
    expect(fakeCtx.lineTo).not.toHaveBeenCalled();
  });

  it('compte plusieurs traits successifs', () => {
    const { cmp } = mount(SignaturePadComponent);
    for (let i = 0; i < 3; i++) {
      cmp.startDraw(mouse(i, i));
      cmp.endDraw();
    }
    expect(cmp.strokeCount()).toBe(3);
  });

  it('undo() restaure l’état précédent et réémet la signature', () => {
    const { cmp } = mount(SignaturePadComponent);
    const signed = vi.fn();
    cmp.signed.subscribe(signed);

    cmp.startDraw(mouse(1, 1)); cmp.endDraw();
    cmp.startDraw(mouse(2, 2)); cmp.endDraw();
    signed.mockClear();

    cmp.undo();
    expect(fakeCtx.putImageData).toHaveBeenCalled();
    expect(cmp.canUndo()).toBe(true); // il reste un état
    expect(signed).toHaveBeenCalledOnce();
  });

  it('undo() du dernier trait vide la signature et émet cleared', () => {
    const { cmp } = mount(SignaturePadComponent);
    const cleared = vi.fn();
    cmp.cleared.subscribe(cleared);

    cmp.startDraw(mouse(1, 1)); cmp.endDraw();
    cmp.undo();

    expect(cmp.hasSignature()).toBe(false);
    expect(cmp.strokeCount()).toBe(0);
    expect(cmp.canUndo()).toBe(false);
    expect(cleared).toHaveBeenCalledOnce();
  });

  it('undo() sans historique est sans effet', () => {
    const { cmp } = mount(SignaturePadComponent);
    cmp.undo();
    expect(fakeCtx.putImageData).not.toHaveBeenCalled();
  });

  it('l’historique d’annulation est plafonné à 30 états', () => {
    const { cmp } = mount(SignaturePadComponent);
    for (let i = 0; i < 35; i++) { cmp.startDraw(mouse(i, i)); cmp.endDraw(); }
    let undos = 0;
    while (cmp.canUndo() && undos < 100) { cmp.undo(); undos++; }
    expect(undos).toBe(30);
  });

  it('clear() efface le canevas, l’historique et émet cleared', () => {
    const { cmp } = mount(SignaturePadComponent);
    const cleared = vi.fn();
    cmp.cleared.subscribe(cleared);

    cmp.startDraw(mouse(1, 1)); cmp.endDraw();
    cmp.clear();

    expect(fakeCtx.clearRect).toHaveBeenCalled();
    expect(cmp.hasSignature()).toBe(false);
    expect(cmp.strokeCount()).toBe(0);
    expect(cmp.canUndo()).toBe(false);
    expect(cleared).toHaveBeenCalledOnce();
  });

  it('getDataURL() renvoie le PNG du canevas', () => {
    const { cmp } = mount(SignaturePadComponent);
    expect(cmp.getDataURL()).toBe(PNG_DATA_URL);
  });

  it('affiche le nombre de traits une fois signé', () => {
    const { fixture, cmp, el } = mount(SignaturePadComponent);
    cmp.startDraw(mouse(1, 1)); cmp.endDraw();
    cmp.startDraw(mouse(2, 2)); cmp.endDraw();
    refresh(fixture);
    expect(el.textContent).toContain('2 traits');
  });

  it('ngOnDestroy() déconnecte l’observateur de redimensionnement', () => {
    const { fixture, cmp } = mount(SignaturePadComponent);
    const obs = (cmp as any).resizeObs;
    fixture.destroy();
    expect(obs.disconnect).toHaveBeenCalled();
  });
});

// ─── SignatureDialog ─────────────────────────────────────────────────────────

describe('SignatureDialog', () => {
  it('ne rend rien tant qu’il est fermé', () => {
    const { el } = mount(SignatureDialog, { open: false });
    expect(el.querySelector('afb-signature-pad')).toBeNull();
  });

  it('onSigned() mémorise la signature', () => {
    const { cmp } = mount(SignatureDialog, { open: false });
    cmp.onSigned(PNG_DATA_URL);
    expect(cmp.signatureData).toBe(PNG_DATA_URL);
  });

  it('le bouton de validation est désactivé sans signature', () => {
    const { el } = mount(SignatureDialog, { open: true });
    const btn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Valider'))!;
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('émet confirm avec la signature une fois signée', () => {
    const { fixture, cmp, el } = mount(SignatureDialog, { open: true });
    const spy = vi.fn();
    cmp.confirm.subscribe(spy);

    cmp.onSigned(PNG_DATA_URL);
    refresh(fixture);

    const btn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Valider'))!;
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    btn.click();
    expect(spy).toHaveBeenCalledWith(PNG_DATA_URL);
  });

  it('le bouton Annuler émet cancel', () => {
    const { cmp, el } = mount(SignatureDialog, { open: true });
    const spy = vi.fn();
    cmp.cancel.subscribe(spy);
    // Le pavé de signature expose lui aussi un bouton « ↩ Annuler » (undo) :
    // on cible le libellé exact du bouton de la boîte de dialogue.
    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Annuler')!
      .click();
    expect(spy).toHaveBeenCalledOnce();
  });
});

// ─── SignatureField ──────────────────────────────────────────────────────────

describe('SignatureField', () => {
  it('affiche l’invite de signature quand le champ est vide', () => {
    const { el } = mount(SignatureField);
    expect(el.textContent).toContain('Cliquez ici pour signer');
    expect(el.querySelector('img')).toBeNull();
  });

  it('affiche la signature capturée et les actions', () => {
    const { el } = mount(SignatureField, { signatureData: PNG_DATA_URL });
    expect(el.querySelector('img')?.getAttribute('src')).toBe(PNG_DATA_URL);
    expect(el.textContent).toContain('Signature capturée');
  });

  it('openDialog() ouvre la boîte de dialogue', () => {
    const { cmp } = mount(SignatureField);
    expect(cmp.dialogOpen()).toBe(false);
    cmp.openDialog();
    expect(cmp.dialogOpen()).toBe(true);
  });

  it('un clic sur l’invite ouvre la boîte de dialogue', () => {
    const { cmp, el } = mount(SignatureField);
    el.querySelector('button')!.click();
    expect(cmp.dialogOpen()).toBe(true);
  });

  it('onConfirm() enregistre la signature, ferme et émet les deux sorties', () => {
    const { cmp } = mount(SignatureField);
    const change = vi.fn();
    const signed = vi.fn();
    cmp.signatureDataChange.subscribe(change);
    cmp.signed.subscribe(signed);

    cmp.openDialog();
    cmp.onConfirm(PNG_DATA_URL);

    expect(cmp.signatureData).toBe(PNG_DATA_URL);
    expect(cmp.dialogOpen()).toBe(false);
    expect(change).toHaveBeenCalledWith(PNG_DATA_URL);
    expect(signed).toHaveBeenCalledWith(PNG_DATA_URL);
  });

  it('clear() vide le champ et émet cleared + changement vide', () => {
    const { cmp } = mount(SignatureField, { signatureData: PNG_DATA_URL });
    const change = vi.fn();
    const cleared = vi.fn();
    cmp.signatureDataChange.subscribe(change);
    cmp.cleared.subscribe(cleared);

    cmp.clear();

    expect(cmp.signatureData).toBe('');
    expect(change).toHaveBeenCalledWith('');
    expect(cleared).toHaveBeenCalledOnce();
  });
});

// ─── SignatureViewer ─────────────────────────────────────────────────────────

describe('SignatureViewer', () => {
  it('affiche un état vide sans signature', () => {
    const { el } = mount(SignatureViewer);
    expect(el.textContent).toContain('Aucune signature capturée');
  });

  it('affiche « en attente » puis « vérifiée »', () => {
    const a = mount(SignatureViewer, { signatureData: PNG_DATA_URL });
    expect(a.el.textContent).toContain('En attente de vérification');

    TestBed.resetTestingModule();
    const b = mount(SignatureViewer, { signatureData: PNG_DATA_URL, verified: true });
    expect(b.el.textContent).toContain('Signature vérifiée');
  });

  it('masque les actions de validation par défaut', () => {
    const { el } = mount(SignatureViewer, { signatureData: PNG_DATA_URL });
    expect(el.textContent).not.toContain('Rejeter');
  });

  it('émet verify et reject quand les actions sont affichées', () => {
    const { cmp, el } = mount(SignatureViewer, { signatureData: PNG_DATA_URL, showActions: true });
    const verify = vi.fn();
    const reject = vi.fn();
    cmp.verify.subscribe(verify);
    cmp.reject.subscribe(reject);

    const buttons = Array.from(el.querySelectorAll('button'));
    buttons.find((b) => b.textContent?.includes('Valider'))!.click();
    buttons.find((b) => b.textContent?.includes('Rejeter'))!.click();

    expect(verify).toHaveBeenCalledOnce();
    expect(reject).toHaveBeenCalledOnce();
  });

  it('affiche la date quand elle est fournie', () => {
    const { el } = mount(SignatureViewer, { signatureData: PNG_DATA_URL, date: '12 mai 2025' });
    expect(el.textContent).toContain('12 mai 2025');
  });

  // ── openFull() : liste blanche d'URI de données ──────────────────────────

  describe('openFull()', () => {
    let openSpy: ReturnType<typeof vi.fn>;
    let createUrl: ReturnType<typeof vi.fn>;
    let revokeUrl: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      openSpy = vi.fn(() => ({} as Window));
      createUrl = vi.fn(() => 'blob:fake');
      revokeUrl = vi.fn();
      vi.stubGlobal('open', openSpy);
      window.open = openSpy as any;
      URL.createObjectURL = createUrl as any;
      URL.revokeObjectURL = revokeUrl as any;
    });

    it('ouvre un onglet pour un PNG base64 valide', () => {
      const { cmp } = mount(SignatureViewer, { signatureData: PNG_DATA_URL });
      cmp.openFull();
      expect(createUrl).toHaveBeenCalledOnce();
      expect(openSpy).toHaveBeenCalledWith('blob:fake', '_blank', 'noopener,noreferrer,width=600,height=400');
    });

    it.each([
      'data:image/jpeg;base64,AAAA',
      'data:image/jpg;base64,AAAA',
      'data:image/webp;base64,AAAA',
    ])('accepte le type d’image autorisé %s', (uri) => {
      const { cmp } = mount(SignatureViewer, { signatureData: uri });
      cmp.openFull();
      expect(openSpy).toHaveBeenCalledOnce();
    });

    it('ne fait rien sans signature', () => {
      const { cmp } = mount(SignatureViewer, { signatureData: '' });
      cmp.openFull();
      expect(openSpy).not.toHaveBeenCalled();
    });

    it.each([
      ['HTML déguisé', 'data:text/html;base64,PHN2Zz48L3N2Zz4='],
      ['SVG (vecteur scriptable)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
      ['schéma javascript', 'javascript:alert(1)'],
      ['URL distante', 'https://evil.example/x.png'],
      ['base64 avec caractères interdits', 'data:image/png;base64,AAA<script>'],
      ['sans charge utile', 'data:image/png;base64,'],
    ])('refuse %s', (_cas, uri) => {
      const { cmp } = mount(SignatureViewer, { signatureData: uri });
      cmp.openFull();
      expect(createUrl).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('refuse une image de plus de 2 Mo', () => {
      const gros = 'data:image/png;base64,' + 'A'.repeat(2_000_001);
      const { cmp } = mount(SignatureViewer, { signatureData: gros });
      cmp.openFull();
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('révoque immédiatement l’URL si la fenêtre est bloquée', () => {
      openSpy.mockReturnValue(null as unknown as Window);
      const { cmp } = mount(SignatureViewer, { signatureData: PNG_DATA_URL });
      cmp.openFull();
      expect(revokeUrl).toHaveBeenCalledWith('blob:fake');
    });

    it('révoque l’URL après 60 s quand la fenêtre s’est ouverte', () => {
      vi.useFakeTimers();
      const { cmp } = mount(SignatureViewer, { signatureData: PNG_DATA_URL });
      cmp.openFull();
      expect(revokeUrl).not.toHaveBeenCalled();
      vi.advanceTimersByTime(60_000);
      expect(revokeUrl).toHaveBeenCalledWith('blob:fake');
      vi.useRealTimers();
    });
  });
});
