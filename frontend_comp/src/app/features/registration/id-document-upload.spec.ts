import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { IdDocumentUpload } from './id-document-upload';
import { AnalysePiece, IdDocumentService } from './id-document-service';

const ACCEPTEE: AnalysePiece = {
  ok: true, type: 'CNI', motifs: [], champsDetectes: ['Nom', 'Date de naissance'],
  largeur: 1200, hauteur: 800, nettete: 300, texte: 'CARTE NATIONALE D IDENTITE MBALLA',
};

const REFUSEE: AnalysePiece = {
  ok: false, type: null, motifs: ['Image floue : les informations ne sont pas lisibles.'],
  champsDetectes: [], largeur: 800, hauteur: 500, nettete: 10, texte: '',
};

describe('IdDocumentUpload', () => {
  let docs: { analyser: ReturnType<typeof vi.fn> };

  function make() {
    docs = { analyser: vi.fn(async () => ACCEPTEE) };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [IdDocumentUpload],
      providers: [{ provide: IdDocumentService, useValue: docs }],
    });
    return TestBed.createComponent(IdDocumentUpload);
  }

  it('propose les deux modes : importer un fichier ou photographier', () => {
    const f = make();
    f.detectChanges();
    const t = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(t).toContain('Importer un fichier');
    expect(t).toContain('Photographier la pièce');
  });

  it('ouvre la caméra pour le côté demandé', () => {
    const f = make();
    f.detectChanges();
    f.componentInstance.camera.set('RECTO');
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('afb-document-camera')).not.toBeNull();
  });

  // ─── Le cœur : une photo n'est PAS une porte dérobée ───────────────────────

  it('une pièce PHOTOGRAPHIÉE subit la même analyse qu’un import', async () => {
    const cmp = make().componentInstance;
    const emis = vi.fn();
    cmp.pieces.subscribe(emis);

    await cmp.onPhoto('data:image/jpeg;base64,AAA', 'RECTO');

    expect(docs.analyser).toHaveBeenCalledWith('data:image/jpeg;base64,AAA');
    expect(cmp.valide('RECTO')).toBe(true);
    expect(emis).toHaveBeenCalledWith([expect.objectContaining({ type: 'CNI', cote: 'RECTO' })]);
    expect(cmp.camera()).toBeNull();   // la caméra se referme après la prise
  });

  it('une photo REFUSÉE par l’analyse n’est pas retenue, et le motif s’affiche', async () => {
    const cmp = make().componentInstance;
    docs.analyser.mockResolvedValueOnce(REFUSEE);

    await cmp.onPhoto('data:image/jpeg;base64,flou', 'RECTO');

    expect(cmp.valide('RECTO')).toBe(false);
    expect(cmp.motifs('RECTO').join(' ')).toContain('floue');
  });

  it('expose les mentions lues sur la pièce acceptée', async () => {
    const cmp = make().componentInstance;
    await cmp.onPhoto('data:image/jpeg;base64,AAA', 'RECTO');
    expect(cmp.champs('RECTO')).toContain('Nom');
    expect(cmp.libelle('RECTO')).toContain("Carte nationale d'identité");
  });

  it('réinitialiser() retire la pièce et referme la caméra', async () => {
    const cmp = make().componentInstance;
    const emis = vi.fn();
    await cmp.onPhoto('data:image/jpeg;base64,AAA', 'RECTO');
    cmp.pieces.subscribe(emis);

    cmp.reinitialiser('RECTO');

    expect(cmp.valide('RECTO')).toBe(false);
    expect(cmp.camera()).toBeNull();
    expect(emis).toHaveBeenCalledWith([]);
  });
});
