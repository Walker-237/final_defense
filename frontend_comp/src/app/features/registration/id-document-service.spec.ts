import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { IdDocumentService } from './id-document-service';

/**
 * L'OCR (Tesseract) et le décodage d'image ne tournent pas sous jsdom : on
 * simule ce qui est LU sur le document et la qualité de l'image, puis on vérifie
 * la décision — c'est elle qui refuse un selfie, un flou ou un document quelconque.
 */
describe('IdDocumentService', () => {
  let svc: IdDocumentService;

  /** Prépare le service en simulant l'image (taille/netteté) et le texte OCR. */
  function prepare(opts: { texte: string; largeur?: number; hauteur?: number; nettete?: number }) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    svc = TestBed.inject(IdDocumentService);

    const s = svc as unknown as {
      ocr: (u: string) => Promise<string>;
      nettete: (i: HTMLImageElement) => number;
      chargerImage: (u: string) => Promise<HTMLImageElement>;
    };
    s.ocr = () => Promise.resolve(opts.texte);
    s.nettete = () => opts.nettete ?? 200;
    s.chargerImage = () => Promise.resolve({
      naturalWidth: opts.largeur ?? 1200,
      naturalHeight: opts.hauteur ?? 800,
    } as HTMLImageElement);
    return svc;
  }

  const CNI = `REPUBLIQUE DU CAMEROUN
    CARTE NATIONALE D'IDENTITE
    NOM: MBALLA
    PRENOM: Jean Paul
    DATE DE NAISSANCE: 12/05/1990
    SEXE: M  NATIONALITE: Camerounaise
    N° 123456789  VALABLE JUSQU'AU 2030`;

  // ─── Pièces acceptées ─────────────────────────────────────────────────────

  it('accepte une CNI nette et lisible', async () => {
    const r = await prepare({ texte: CNI }).analyser('data:image/jpeg;base64,AAA');
    expect(r.ok).toBe(true);
    expect(r.type).toBe('CNI');
    expect(r.motifs).toEqual([]);
    expect(r.champsDetectes).toContain('Nom');
    expect(r.champsDetectes).toContain('Date de naissance');
  });

  it('reconnaît un passeport (y compris via la ligne MRZ)', async () => {
    const r = await prepare({
      texte: 'PASSEPORT REPUBLIQUE DU CAMEROUN\nNOM: NGONO\nDATE DE NAISSANCE 01/01/1990\nP<CMRNGONO<<ALICE<<<<<<<<<<<<',
    }).analyser('x');
    expect(r.ok).toBe(true);
    expect(r.type).toBe('PASSEPORT');
  });

  it('reconnaît une carte de séjour', async () => {
    const r = await prepare({
      texte: 'TITRE DE SEJOUR\nNOM: DUPONT\nPRENOM: Marie\nDATE DE NAISSANCE 03/03/1985\nNATIONALITE Francaise',
    }).analyser('x');
    expect(r.ok).toBe(true);
    expect(r.type).toBe('CARTE_SEJOUR');
  });

  // ─── La détection du type ne BLOQUE plus (elle refusait des pièces valables) ──

  it('accepte une pièce même quand l’OCR ne reconnaît pas le type', async () => {
    // Reflets, police inhabituelle… : l'OCR ne lit presque rien d'exploitable.
    const r = await prepare({ texte: 'REPUBLI... CAM....OUN  ####' }).analyser('x');
    expect(r.ok).toBe(true);        // l'image est nette : elle passe
    expect(r.type).toBeNull();      // type inconnu — purement indicatif
    expect(r.motifs).toEqual([]);
  });

  it('n’oppose plus aucun refus lié à la nature du document', async () => {
    const r = await prepare({ texte: '   ' }).analyser('x');
    expect(r.motifs.join(' ')).not.toContain("pièce d'identité");
    expect(r.motifs.join(' ')).not.toContain('Document non reconnu');
  });

  it('transmet quand même le texte lu au back-office (qui tranche)', async () => {
    const r = await prepare({
      texte: 'FACTURE ENEO\nMontant a payer 15000 FCFA',
    }).analyser('x');
    expect(r.texte).toContain('FACTURE ENEO');   // l'agent verra ce qui a été lu
  });

  // ─── Refus : qualité insuffisante (SEUL contrôle bloquant) ────────────────

  it('REFUSE une image floue (informations illisibles)', async () => {
    const r = await prepare({ texte: CNI, nettete: 10 }).analyser('x');
    expect(r.ok).toBe(false);
    expect(r.motifs.join(' ')).toContain('floue');
  });

  it('REFUSE une image trop petite', async () => {
    const r = await prepare({ texte: CNI, largeur: 300, hauteur: 200 }).analyser('x');
    expect(r.ok).toBe(false);
    expect(r.motifs.join(' ')).toContain('trop petite');
  });

  it('accepte une pièce reconnue même si les mentions se lisent mal', async () => {
    // Le titre est lu, mais aucun champ d'identité n'est exploitable : l'image est
    // nette, on l'accepte — c'est l'agent qui jugera.
    const r = await prepare({
      texte: "CARTE NATIONALE D'IDENTITE ................................",
    }).analyser('x');
    expect(r.ok).toBe(true);
    expect(r.type).toBe('CNI');
  });

  // ─── Divers ───────────────────────────────────────────────────────────────

  it('expose le texte lu et les indicateurs pour le back-office', async () => {
    const r = await prepare({ texte: CNI, largeur: 1200, hauteur: 800, nettete: 321.7 }).analyser('x');
    expect(r.texte).toContain('MBALLA');
    expect(r.largeur).toBe(1200);
    expect(r.nettete).toBe(322);
  });

  it('ne fait rien côté serveur (SSR)', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });
    const r = await TestBed.inject(IdDocumentService).analyser('x');
    expect(r.ok).toBe(false);
    expect(r.texte).toBe('');
  });
});
