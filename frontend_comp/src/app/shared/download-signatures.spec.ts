import { describe, it, expect } from 'vitest';
import { buildAvisOpereHtml, buildClientOrderFormHtml, formuleDirigeant, SignataireBanque } from './download';
import { Order, Emission } from '../core/models/models';

/** Ordre minimal suffisant pour rendre l'avis. */
const ORDRE = {
  id: 'o1', reference: 'ORD-2026-000001', emissionId: 'em-1',
  emissionCode: 'CM1300001201', isin: 'CM1300001201', nature: 'BTA',
  emetteur: 'Cameroun', clientId: 'c1', clientNom: 'MBALLA Jean',
  compteEspeces: 'CPT-001', compteTitres: 'TCPT-001',
  volume: 10, montant: 10_000_000, tauxSoumis: 6,
  status: 'TOTALEMENT_RETENU', dateSoumission: '2026-01-01 08:00', canal: 'EN_LIGNE',
} as unknown as Order;

const EMISSION = {
  id: 'em-1', code: 'CM1300001201', isin: 'CM1300001201', nature: 'BTA',
  libelle: 'BTA 52 semaines', emetteur: 'Cameroun',
  dateEmission: '2026-01-01', fermetureSouscription: '2026-01-01 09:00',
  dateEcheance: '2026-12-29', valeurNominaleUnitaire: 1_000_000, tauxNominal: 6,
  dureeJours: 360, status: 'PUBLIE',
} as unknown as Emission;

const SIG = (over: Partial<SignataireBanque> = {}): SignataireBanque => ({
  nom: 'FOTSO Marie',
  fonction: 'Directeur Général',
  signatureData: 'data:image/png;base64,iVBORw0KGgo=',
  ...over,
});

describe('Avis d’opéré — signatures des dirigeants', () => {
  it('n’affiche aucune signature quand l’administration n’en a défini aucune', () => {
    const html = buildAvisOpereHtml(ORDRE, EMISSION, {});
    // Le bloc « Pour Le SVT » reste présent, mais sans image de signature.
    expect(html).toContain('Pour Le SVT Afriland First Bank');
    expect(html).not.toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  it('appose la signature, le nom et la fonction du dirigeant', () => {
    const html = buildAvisOpereHtml(ORDRE, EMISSION, { signataires: [SIG()] });
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=');
    expect(html).toContain('FOTSO Marie');
    expect(html).toContain('Directeur Général');
  });

  it('appose plusieurs signatures (double signature)', () => {
    const html = buildAvisOpereHtml(ORDRE, EMISSION, {
      signataires: [SIG(), SIG({ nom: 'BIYA Paul', fonction: 'Responsable Middle Office' })],
    });
    expect(html).toContain('FOTSO Marie');
    expect(html).toContain('BIYA Paul');
    expect(html).toContain('Responsable Middle Office');
  });

  it('ignore une signature dont l’image n’est pas une data URI d’image (anti-XSS)', () => {
    const html = buildAvisOpereHtml(ORDRE, EMISSION, {
      signataires: [
        SIG({ signatureData: 'javascript:alert(1)' }),
        SIG({ nom: 'HOSTILE', signatureData: 'https://evil.example/x.png' }),
      ],
    });
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('HOSTILE');
  });

  it('échappe le nom et la fonction (injection HTML)', () => {
    const html = buildAvisOpereHtml(ORDRE, EMISSION, {
      signataires: [SIG({ nom: '<script>alert(1)</script>', fonction: '"><img onerror=x>' })],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img onerror=x>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe("Formule d'adresse = « dirigeant » du client", () => {
  it("avis d'opéré : utilise le champ dirigeant quand il est renseigné", () => {
    const html = buildAvisOpereHtml(
      { ...ORDRE, dirigeant: 'Madame la Présidente' } as Order, EMISSION, {});
    expect(html).toContain('Madame la Présidente,');
  });

  it("avis d'opéré : défaut PP = Monsieur", () => {
    const html = buildAvisOpereHtml(
      { ...ORDRE, dirigeant: undefined, typePersonne: 'PP' } as Order, EMISSION, {});
    expect(html).toContain('Monsieur,');
  });

  it("avis d'opéré : défaut PM = Directeur (plus « Monsieur le Directeur Général »)", () => {
    const html = buildAvisOpereHtml(
      { ...ORDRE, dirigeant: undefined, typePersonne: 'PM' } as Order, EMISSION, {});
    expect(html).toContain('Directeur,');
    expect(html).not.toContain('Monsieur le Directeur Général,');
  });

  it("bon d'ordre : la formule de politesse porte le dirigeant", () => {
    const html = buildClientOrderFormHtml({ ...ORDRE, dirigeant: 'Monsieur le Maire' } as Order);
    expect(html).toContain('Veuillez agréer, Monsieur le Maire, ');
  });

  it('formuleDirigeant : contenu du champ, sinon défaut selon le type', () => {
    expect(formuleDirigeant({ ...ORDRE, dirigeant: '  Le Gérant  ' } as Order)).toBe('Le Gérant');
    expect(formuleDirigeant({ ...ORDRE, dirigeant: undefined, typePersonne: 'PP' } as Order)).toBe('Monsieur');
    expect(formuleDirigeant({ ...ORDRE, dirigeant: undefined, typePersonne: 'PM' } as Order)).toBe('Directeur');
  });
});
