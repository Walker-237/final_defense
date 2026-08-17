import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { FaceScanComponent } from './face-scan';

/**
 * Le gros du composant (getUserMedia + WASM MediaPipe) ne s'exécute que dans un
 * vrai navigateur : sous jsdom on couvre la garde SSR, les consignes et l'état.
 */
describe('FaceScanComponent', () => {
  function make(platform: 'browser' | 'server') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FaceScanComponent],
      providers: [{ provide: PLATFORM_ID, useValue: platform }],
    });
    return TestBed.createComponent(FaceScanComponent);
  }

  // ─── Contrôles avant capture : visage entier + luminosité ──────────────────
  //
  // On pilote directement la boucle d'analyse avec des repères fabriqués, et on
  // simule la luminosité mesurée : ce sont ces règles qui interdisent de capturer
  // un visage coupé ou une image trop sombre / surexposée.

  /** Repères formant un rectangle de visage dans la zone demandée. */
  function reperes(minX: number, minY: number, maxX: number, maxY: number) {
    const pts = [
      { x: minX, y: minY, z: 0 }, { x: maxX, y: minY, z: 0 },
      { x: minX, y: maxY, z: 0 }, { x: maxX, y: maxY, z: 0 },
    ];
    // marks[1] est utilisé comme « bout du nez » : on le place au centre.
    pts.splice(1, 0, { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: 0 });
    return pts;
  }

  /** Visage bien cadré : centré, de bonne taille, ENTIÈREMENT contenu dans l'ovale. */
  const VISAGE_OK = () => reperes(0.34, 0.20, 0.66, 0.80);

  /** Analyse une frame en imposant la luminosité mesurée. */
  function analyser(cmp: FaceScanComponent, marks: any[], luminosite: number) {
    const c = cmp as any;
    c.luminositeVisage = () => luminosite;   // mesure vidéo indisponible sous jsdom
    c.dessiner = () => undefined;            // pas de canvas réel
    c.traiter({ faceLandmarks: [marks], faceBlendshapes: [{ categories: [] }] });
  }

  it('REFUSE un visage coupé (hors du cadre)', () => {
    const cmp = make('server').componentInstance;
    // Le menton sort du cadre (maxY = 1.02) → visage tronqué.
    analyser(cmp, reperes(0.30, 0.15, 0.70, 1.02), 130);
    expect(cmp.etape()).toBe('visage-coupe');
    expect(cmp.consigne()).toContain('coupé');
  });

  it('REFUSE un visage qui touche le bord du cadre', () => {
    const cmp = make('server').componentInstance;
    analyser(cmp, reperes(0.0, 0.15, 0.40, 0.85), 130);
    expect(cmp.etape()).toBe('visage-coupe');
  });

  it('REFUSE une image trop sombre', () => {
    const cmp = make('server').componentInstance;
    analyser(cmp, VISAGE_OK(), 25);
    expect(cmp.etape()).toBe('trop-sombre');
    expect(cmp.consigne()).toContain('sombre');
  });

  it('REFUSE une image surexposée', () => {
    const cmp = make('server').componentInstance;
    analyser(cmp, VISAGE_OK(), 245);
    expect(cmp.etape()).toBe('trop-clair');
    expect(cmp.consigne()).toContain('surexposée');
  });

  it('avec un visage entier, centré et bien éclairé, demande le clignement', () => {
    const cmp = make('server').componentInstance;
    analyser(cmp, VISAGE_OK(), 130);
    // Cadrage et luminosité OK → on passe au challenge de vivacité.
    expect(cmp.etape()).toBe('cligner');
  });

  // ─── Centrage dans l'ovale : sans cela, aucune photo ───────────────────────

  it('REFUSE un visage décalé vers la gauche (hors du centre de l’ovale)', () => {
    const cmp = make('server').componentInstance;
    analyser(cmp, reperes(0.06, 0.15, 0.46, 0.85), 130);   // centre cx ≈ 0,26
    expect(cmp.etape()).toBe('centrer');
    expect(cmp.consigne()).toContain('Centrez');
  });

  it('REFUSE un visage décalé vers le bas', () => {
    const cmp = make('server').componentInstance;
    analyser(cmp, reperes(0.30, 0.35, 0.70, 0.97), 130);   // centre cy ≈ 0,66
    expect(cmp.etape()).not.toBe('cligner');
  });

  it('REFUSE un visage qui DÉBORDE de l’ovale, même bien centré', () => {
    const cmp = make('server').componentInstance;
    // Centré (0,5/0,5) mais trop large : les coins sortent de l'ellipse.
    analyser(cmp, reperes(0.10, 0.10, 0.90, 0.90), 130);
    expect(cmp.etape()).toBe('centrer');
  });

  it('ACCEPTE un visage bien centré et contenu dans l’ovale', () => {
    const cmp = make('server').componentInstance;
    analyser(cmp, reperes(0.34, 0.20, 0.66, 0.80), 130);
    expect(cmp.etape()).toBe('cligner');
  });

  it('n’accuse pas l’utilisateur quand la mesure de luminosité est indisponible', () => {
    const cmp = make('server').componentInstance;
    analyser(cmp, VISAGE_OK(), -1);   // vidéo pas encore prête
    expect(cmp.etape()).not.toBe('trop-sombre');
  });

  it('signale l’absence de visage', () => {
    const cmp = make('server').componentInstance;
    analyser(cmp, [], 130);
    expect(cmp.etape()).toBe('sans-visage');
  });

  it('démarre à l’étape « chargement » avec la bonne consigne', () => {
    const cmp = make('server').componentInstance;
    expect(cmp.etape()).toBe('chargement');
    expect(cmp.consigne()).toContain('Préparation');
  });

  it('la consigne suit l’étape courante', () => {
    const cmp = make('server').componentInstance;
    cmp.etape.set('cligner');
    expect(cmp.consigne()).toContain('Clignez');
    cmp.etape.set('centrer');
    expect(cmp.consigne()).toContain('Centrez');
    cmp.etape.set('capture');
    expect(cmp.consigne()).toContain('capturé');
    cmp.etape.set('erreur');
    expect(cmp.consigne()).toContain('indisponible');
  });

  it('ne démarre pas la caméra côté serveur (SSR)', async () => {
    const fixture = make('server');
    await fixture.componentInstance.ngAfterViewInit();
    // Reste en « chargement » : aucun accès caméra/WASM côté serveur.
    expect(fixture.componentInstance.etape()).toBe('chargement');
  });

  it('expose une sortie « captured »', () => {
    const cmp = make('server').componentInstance;
    expect(cmp.captured).toBeDefined();
  });

  it('affiche le bloc d’espace réservé (overlay + vidéo)', () => {
    const fixture = make('server');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('video')).not.toBeNull();
    expect(el.querySelector('canvas')).not.toBeNull();
  });
});
