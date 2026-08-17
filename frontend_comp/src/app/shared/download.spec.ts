import { describe, it, expect } from 'vitest';
import { computeAvisOpere } from './download';

// ─── Miroir des constantes privées (pour les calculs attendus) ────────────────
const COMMISSION = 0.0010;  // 0,10 %
const FVA        = 0.1925;  // 19,25 %
const BASE_BTA   = 360;
const BASE_OTA   = 365;

// ─── Helpers ─────────────────────────────────────────────────────────────────

type O = Parameters<typeof computeAvisOpere>[0];
type E = Parameters<typeof computeAvisOpere>[1];

/**
 * Ordre minimal valide.
 * - fermetureSouscription '2025-01-01' → valueDate 2025-01-03
 * - dateEcheance '2025-12-29'          → joursInterets = 360 (ACT/360 base BTA)
 */
function mkOrder(overrides: Partial<O> = {}): O {
  return {
    id: 'ord-1', reference: 'ORD-2025-000001',
    emissionId: 'em-1', emissionCode: 'CM1300001201',
    isin: 'CM1300001201', nature: 'BTA',
    emetteur: 'Cameroun', clientId: 'cli-1', clientNom: 'Client Test',
    compteEspeces: 'CPT-001', compteTitres: 'TCPT-001',
    volume: 10, montant: 10_000_000,
    tauxSoumis: 6, status: 'TOTALEMENT_RETENU',
    dateSoumission: '2025-01-01T08:00:00Z', canal: 'EN_LIGNE',
    ...overrides,
  } as O;
}

function mkEmission(overrides: Partial<E> = {}): E {
  return {
    id: 'em-1', code: 'CM1300001201', isin: 'CM1300001201',
    libelle: 'BTA 52 semaines', nature: 'BTA',
    paysCode: 'CMR', emetteur: 'Cameroun',
    dateEmission: '2025-01-01',
    fermetureSouscription: '2025-01-01 09:00',  // +2j → valueDate = 2025-01-03
    dateEcheance: '2025-12-29',                  // 360 j depuis 2025-01-03
    dateReglement: '2025-01-02',
    ouvertureSouscription: '2024-12-25 08:00',
    dureeJours: 360, valeurNominaleUnitaire: 1_000_000,
    montantGlobal: 20_000_000_000, tauxNominal: 6,
    montantMinimum: 1_000_000, modeAdjudication: 'TAUX',
    status: 'PUBLIE', observation: 'NOUVELLE EMISSION',
    ...overrides,
  } as E;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('computeAvisOpere', () => {

  // ══════════════════════════════════════════════════════════════════
  // BTA — Nouvelle émission (zéro coupon, intérêts précomptés ACT/360)
  // ══════════════════════════════════════════════════════════════════

  describe('BTA — nouvelle émission', () => {

    it('calcule joursInterets = 360 entre valueDate et échéance', () => {
      const c = computeAvisOpere(mkOrder(), mkEmission());
      expect(c.joursInterets).toBe(360);
    });

    it('dateValeur = fermetureSouscription + 2 jours calendaires', () => {
      const c = computeAvisOpere(mkOrder(), mkEmission());
      // fermeture 2025-01-01 → valueDate 2025-01-03
      expect(c.dateValeur).not.toBeNull();
      const dv = c.dateValeur!;
      expect(dv.getFullYear()).toBe(2025);
      expect(dv.getMonth()).toBe(0);   // janvier = 0
      expect(dv.getDate()).toBe(3);
    });

    it('intérêts précomptés = montantAdjugé × taux/100 × jours/360', () => {
      // 10 000 000 × 6 % × 360/360 = 600 000
      const c = computeAvisOpere(mkOrder(), mkEmission());
      expect(c.interets).toBe(600_000);
    });

    it('coupon couru = 0 pour une nouvelle émission', () => {
      const c = computeAvisOpere(mkOrder(), mkEmission());
      expect(c.couponCouru).toBe(0);
    });

    it('décote = 0 (BTA = zéro coupon, pas de décote)', () => {
      const c = computeAvisOpere(mkOrder(), mkEmission());
      expect(c.decote).toBe(0);
    });

    it('montantNet = montantAdjugé − intérêts', () => {
      // 10 000 000 − 600 000 = 9 400 000
      const c = computeAvisOpere(mkOrder(), mkEmission());
      expect(c.montantNet).toBe(9_400_000);
    });

    it('commission de courtage = 0,10 % du montantAdjugé', () => {
      // 10 000 000 × 0,001 = 10 000
      const c = computeAvisOpere(mkOrder(), mkEmission());
      expect(c.commissionCourtage).toBe(10_000);
    });

    it('FVA = 19,25 % de la commission de courtage', () => {
      // 10 000 × 0,1925 = 1 925
      const c = computeAvisOpere(mkOrder(), mkEmission());
      expect(c.fva).toBe(1_925);
    });

    it('netADebite = montantNet + commission + FVA', () => {
      // 9 400 000 + 10 000 + 1 925 = 9 411 925
      const c = computeAvisOpere(mkOrder(), mkEmission());
      expect(c.netADebite).toBe(9_411_925);
    });

    it('tauxAdjuge a priorité sur tauxNominal pour le calcul des intérêts', () => {
      const c = computeAvisOpere(
        mkOrder({ tauxAdjuge: 6.5, volumeAlloue: 10, montantAdjuge: 10_000_000 }),
        mkEmission({ tauxNominal: 6 }),
      );
      // 10 000 000 × 6,5 % × 360/360 = 650 000
      expect(c.interets).toBe(650_000);
    });

    it('expose quantiteDemandee, montantDemande et prix', () => {
      const c = computeAvisOpere(mkOrder({ tauxSoumis: 7 }), mkEmission());
      expect(c.quantiteDemandee).toBe(10);
      expect(c.montantDemande).toBe(10_000_000);
      expect(c.prix).toBe(7);   // tauxSoumis car tauxAdjuge absent
    });

  });

  // ══════════════════════════════════════════════════════════════════
  // BTA — Abondement (coupon couru ACT/360)
  // ══════════════════════════════════════════════════════════════════

  describe('BTA — abondement', () => {

    // dateEmission 2025-01-01, fermeture 2025-07-01 → valueDate 2025-07-03
    // dernierAnniversaire = 2025-01-01
    // joursCoupon = 183 j (jan:30 + fév:28 + mar:31 + avr:30 + mai:31 + jun:30 + 3)
    // couponCouru = 10 000 000 × 6 % × 183/360 = 305 000

    const abondOrder = () => mkOrder({ montantAdjuge: 10_000_000, volumeAlloue: 10 });
    const abondEm    = () => mkEmission({
      observation: 'ABONDEMENT',
      dateEmission: '2025-01-01',
      fermetureSouscription: '2025-07-01 09:00',
      dateEcheance: '2026-06-30',
    });

    it('coupon couru BTA = montantAdjugé × taux/100 × joursCoupon/360', () => {
      const c = computeAvisOpere(abondOrder(), abondEm());
      expect(c.couponCouru).toBe(305_000);
    });

    it('coupon couru = 0 quand observation est "NOUVELLE EMISSION"', () => {
      const c = computeAvisOpere(
        abondOrder(),
        mkEmission({ observation: 'NOUVELLE EMISSION' }),
      );
      expect(c.couponCouru).toBe(0);
    });

    it('coupon couru = 0 quand observation est absente', () => {
      const c = computeAvisOpere(abondOrder(), mkEmission({ observation: undefined }));
      expect(c.couponCouru).toBe(0);
    });

    it('montantNet = montantAdjugé − intérêts + couponCouru', () => {
      const c = computeAvisOpere(abondOrder(), abondEm());
      expect(c.montantNet).toBeCloseTo(c.montantAdjuge - c.interets + c.couponCouru, 8);
    });

  });

  // ══════════════════════════════════════════════════════════════════
  // OTA — Nouvelle émission (taux fixe, prix + décote ACT/365)
  // ══════════════════════════════════════════════════════════════════

  describe('OTA — nouvelle émission', () => {

    // tauxSoumis = prix d'achat en %, tauxNominal = coupon annuel
    // tauxInteret = em.tauxNominal (car tauxAdjuge absent)
    // prix       = tauxSoumis

    const orderOta = (tauxSoumis = 95) =>
      mkOrder({ nature: 'OTA', tauxSoumis });
    const emOta = (tauxNominal = 6.20) =>
      mkEmission({ nature: 'OTA', tauxNominal, observation: 'NOUVELLE EMISSION' });

    it('intérêt annuel = montantAdjugé × tauxNominal/100 (pas de base jours)', () => {
      // 10 000 000 × 6,20 % = 620 000
      const c = computeAvisOpere(orderOta(), emOta());
      expect(c.interets).toBe(620_000);
    });

    it('coupon couru = 0 pour une nouvelle émission', () => {
      const c = computeAvisOpere(orderOta(), emOta());
      expect(c.couponCouru).toBe(0);
    });

    it('décote = (1 − prix/100) × montantAdjugé', () => {
      // (1 − 0,95) × 10 000 000 ≈ 500 000 (arrondi flottant IEEE 754)
      const c = computeAvisOpere(orderOta(95), emOta());
      expect(c.decote).toBeCloseTo(500_000, 4);
    });

    it('montantNet = montantAdjugé − décote (coupon non déduit à la souscription)', () => {
      // 10 000 000 − 500 000 ≈ 9 500 000
      const c = computeAvisOpere(orderOta(95), emOta());
      expect(c.montantNet).toBeCloseTo(9_500_000, 4);
    });

    it('décote = 0 quand prix = 100 (OTA au pair)', () => {
      const c = computeAvisOpere(orderOta(100), emOta());
      expect(c.decote).toBe(0);
      expect(c.montantNet).toBe(c.montantAdjuge);
    });

    it('décote clampée à 0 quand prix > 100 (surcote)', () => {
      const c = computeAvisOpere(orderOta(102), emOta());
      expect(c.decote).toBe(0);
    });

    it('commission de courtage = 0,10 % du montantAdjugé', () => {
      const c = computeAvisOpere(orderOta(), emOta());
      expect(c.commissionCourtage).toBe(10_000);
    });

    it('FVA = 19,25 % de la commission de courtage', () => {
      const c = computeAvisOpere(orderOta(), emOta());
      expect(c.fva).toBe(1_925);
    });

    it('netADebite = montantNet + commission + FVA', () => {
      // ≈ 9 500 000 + 10 000 + 1 925 = 9 511 925
      const c = computeAvisOpere(orderOta(95), emOta());
      expect(c.netADebite).toBeCloseTo(9_511_925, 4);
    });

  });

  // ══════════════════════════════════════════════════════════════════
  // OTA — Abondement (coupon couru ACT/365)
  // ══════════════════════════════════════════════════════════════════

  describe('OTA — abondement', () => {

    // Même calendrier que BTA abondement : joursCoupon = 183 j
    // couponCouru = 10 000 000 × 6 % × 183/365

    const abondOrderOta = () =>
      mkOrder({ nature: 'OTA', tauxSoumis: 100, montantAdjuge: 10_000_000, volumeAlloue: 10 });
    const abondEmOta    = () =>
      mkEmission({
        nature: 'OTA', observation: 'ABONDEMENT',
        tauxNominal: 6,
        dateEmission: '2025-01-01',
        fermetureSouscription: '2025-07-01 09:00',
        dateEcheance: '2026-06-30',
      });

    it('coupon couru OTA = montantAdjugé × tauxNominal/100 × joursCoupon/365', () => {
      const c = computeAvisOpere(abondOrderOta(), abondEmOta());
      const attendu = 10_000_000 * (6 / 100) * 183 / BASE_OTA;
      expect(c.couponCouru).toBeCloseTo(attendu, 6);
    });

    it('montantNet = montantAdjugé − décote + couponCouru', () => {
      const c = computeAvisOpere(abondOrderOta(), abondEmOta());
      expect(c.montantNet).toBeCloseTo(c.montantAdjuge - c.decote + c.couponCouru, 8);
    });

  });

  // ══════════════════════════════════════════════════════════════════
  // Cas limites
  // ══════════════════════════════════════════════════════════════════

  describe('cas limites', () => {

    it('sans fiche émission : joursInterets = 0, pas de crash', () => {
      const c = computeAvisOpere(mkOrder());
      expect(c.joursInterets).toBe(0);
      expect(c.interets).toBe(0);
      expect(c.couponCouru).toBe(0);
    });

    it('taux = 0 : intérêts, coupon couru et décote = 0', () => {
      const c = computeAvisOpere(
        mkOrder({ tauxAdjuge: 0, tauxSoumis: 0 }),
        mkEmission({ tauxNominal: 0 }),
      );
      expect(c.interets).toBe(0);
      expect(c.couponCouru).toBe(0);
    });

    it('adjudication partielle : montantAdjugé < montant soumis', () => {
      // 10 titres soumis, 5 alloués → montantAdjugé = 5 000 000
      const c = computeAvisOpere(
        mkOrder({ volume: 10, montant: 10_000_000, volumeAlloue: 5, montantAdjuge: 5_000_000 }),
        mkEmission(),
      );
      expect(c.quantiteDemandee).toBe(10);
      expect(c.montantDemande).toBe(10_000_000);
      expect(c.montantAdjuge).toBe(5_000_000);
      // 5 000 000 × 6 % × 360/360 = 300 000
      expect(c.interets).toBe(300_000);
      expect(c.montantNet).toBe(4_700_000);
    });

    it('commission proportionnelle au montant adjugé (pas au montant soumis)', () => {
      const c = computeAvisOpere(
        mkOrder({ volume: 10, montant: 10_000_000, volumeAlloue: 5, montantAdjuge: 5_000_000 }),
        mkEmission(),
      );
      // 5 000 000 × 0,001 = 5 000
      expect(c.commissionCourtage).toBe(5_000);
      expect(c.fva).toBeCloseTo(5_000 * FVA, 8);
    });

    it('montantAdjugé calculé depuis volumeAlloue × valeurNominale si absent', () => {
      // montantAdjuge non fourni → volAdjuge(10) × vn(1_000_000) = 10_000_000
      const c = computeAvisOpere(
        mkOrder({ volumeAlloue: 10 }),   // pas de montantAdjuge explicite
        mkEmission({ valeurNominaleUnitaire: 1_000_000 }),
      );
      expect(c.montantAdjuge).toBe(10_000_000);
    });

    it('valeurNominale calculée depuis montant/volume si em est absent', () => {
      // vn = o.montant / o.volume = 10 000 000 / 10 = 1 000 000
      // montantAdjuge = volAdjuge × vn = 10 × 1 000 000 = 10 000 000
      const c = computeAvisOpere(mkOrder({ volume: 10, montant: 10_000_000 }));
      expect(c.montantAdjuge).toBe(10_000_000);
    });

    it('cohérence interne : netADebite = montantNet + commissionCourtage + fva', () => {
      const c = computeAvisOpere(mkOrder(), mkEmission());
      expect(c.netADebite).toBeCloseTo(c.montantNet + c.commissionCourtage + c.fva, 8);
    });

    it('cohérence interne OTA : netADebite = montantNet + commission + FVA', () => {
      const c = computeAvisOpere(
        mkOrder({ nature: 'OTA', tauxSoumis: 95 }),
        mkEmission({ nature: 'OTA', tauxNominal: 6.20 }),
      );
      expect(c.netADebite).toBeCloseTo(c.montantNet + c.commissionCourtage + c.fva, 8);
    });

  });

});
