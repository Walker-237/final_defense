import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { BoRapports } from './bo-rapports';
import { MockData } from '../../core/services/mock-data';
import { ToastService } from '../../core/services/toast';
import { Order, OrderStatus, TitleType } from '../../core/models/models';

// Le gabarit formate les volumes via `number:'1.0-0':'fr-FR'` : la locale est
// enregistrée par app.config.ts, que le TestBed ne charge pas (sinon NG0701).
registerLocaleData(localeFr, 'fr-FR');

// `genReport()` appelle `downloadBlob()`, qui crée une URL d'objet et clique sur
// une ancre. Le système de test Angular interdit `vi.mock` sur un import relatif :
// on intercepte donc les API navigateur pour capturer le fichier produit.
let blobCapture: Blob | null;
let nomFichier: string;
let creationsUrl: number;

/** Horodatage « YYYY-MM-DD HH:mm » à `daysAgo` jours de maintenant. */
function ago(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 10:00`;
}

/** Date du 1er du mois courant + 1 jour : toujours dans la fenêtre « mois ». */
function ceMois(): string {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), 1, 10, 0);
  if (d.getTime() > n.getTime()) d.setDate(d.getDate() - 1);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 10:00`;
}

function mkOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'o1', reference: 'ORD-2026-000001', emissionId: 'em1', emissionCode: 'CM13',
    isin: 'CM13', nature: 'BTA' as TitleType, emetteur: 'Cameroun',
    clientId: 'c1', clientNom: 'Client Un', compteEspeces: 'CE', compteTitres: 'CT',
    volume: 10, montant: 10_000_000, tauxSoumis: 6,
    status: 'TOTALEMENT_RETENU' as OrderStatus, dateSoumission: ceMois(), canal: 'EN_LIGNE',
    ...over,
  } as Order;
}

let toast: any;
let orders: ReturnType<typeof signal<Order[]>>;

function providers() {
  toast = { success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  return [
    { provide: MockData, useValue: { orders, refreshOrders: vi.fn() } },
    { provide: ToastService, useValue: toast },
  ];
}

function build(list: Order[] = []) {
  TestBed.resetTestingModule();
  orders = signal<Order[]>(list);
  TestBed.configureTestingModule({ providers: providers() });
  return TestBed.runInInjectionContext(() => new BoRapports());
}

/** Variante rendue : le gabarit est inline, ses branches comptent dans la couverture. */
function render(list: Order[] = []) {
  TestBed.resetTestingModule();
  orders = signal<Order[]>(list);
  TestBed.configureTestingModule({ imports: [BoRapports], providers: providers() });
  const fixture = TestBed.createComponent(BoRapports);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

function bouton(el: HTMLElement, extrait: string): HTMLButtonElement {
  return Array.from(el.querySelectorAll('button'))
    .find((b) => b.textContent?.includes(extrait)) as HTMLButtonElement;
}

describe('BoRapports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blobCapture = null;
    nomFichier = '';
    creationsUrl = 0;

    URL.createObjectURL = ((b: Blob) => {
      blobCapture = b;
      creationsUrl++;
      return 'blob:test';
    }) as any;
    URL.revokeObjectURL = (() => undefined) as any;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      nomFichier = this.download;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('recharge les ordres à la construction', () => {
    const cmp = build();
    expect(cmp.period()).toBe('mois');
    expect(cmp.type()).toBe('TOUS');
  });

  // ─── Filtrage ─────────────────────────────────────────────────────────────

  it('filtre les ordres du mois courant', () => {
    const cmp = build([mkOrder({ id: 'dans' }), mkOrder({ id: 'hors', dateSoumission: ago(400) })]);
    expect(cmp.filtered().map((o) => o.id)).toEqual(['dans']);
  });

  it('le filtre de nature restreint aux BTA ou OTA', () => {
    const cmp = build([
      mkOrder({ id: 'bta', nature: 'BTA' }),
      mkOrder({ id: 'ota', nature: 'OTA' }),
    ]);
    expect(cmp.filtered()).toHaveLength(2);

    cmp.type.set('BTA');
    expect(cmp.filtered().map((o) => o.id)).toEqual(['bta']);

    cmp.type.set('OTA');
    expect(cmp.filtered().map((o) => o.id)).toEqual(['ota']);
  });

  it('les périodes glissantes élargissent la fenêtre', () => {
    const cmp = build([mkOrder({ id: 'vieux', dateSoumission: ago(75) })]);
    expect(cmp.filtered()).toHaveLength(0); // hors du mois courant

    cmp.period.set('6');
    expect(cmp.filtered().map((o) => o.id)).toEqual(['vieux']);
  });

  it('la période personnalisée borne sur les dates saisies', () => {
    const cmp = build([mkOrder({ id: 'a', dateSoumission: ago(10) })]);
    cmp.period.set('custom');
    cmp.dateDu.set(ago(20).slice(0, 10));
    cmp.dateAu.set(ago(5).slice(0, 10));
    expect(cmp.filtered().map((o) => o.id)).toEqual(['a']);

    cmp.dateAu.set(ago(15).slice(0, 10)); // fenêtre qui exclut l'ordre
    expect(cmp.filtered()).toHaveLength(0);
  });

  it('la période personnalisée tolère des dates inversées', () => {
    const cmp = build([mkOrder({ id: 'a', dateSoumission: ago(10) })]);
    cmp.period.set('custom');
    cmp.dateDu.set(ago(5).slice(0, 10));   // du > au
    cmp.dateAu.set(ago(20).slice(0, 10));
    expect(cmp.filtered().map((o) => o.id)).toEqual(['a']);
  });

  it('la période personnalisée sans dates retombe sur le mois courant', () => {
    const cmp = build([mkOrder({ id: 'a' })]);
    cmp.period.set('custom');
    expect(cmp.filtered().map((o) => o.id)).toEqual(['a']);
  });

  // ─── KPI et tendances ─────────────────────────────────────────────────────

  it('agrège volume, taux de réussite et clients actifs', () => {
    const cmp = build([
      mkOrder({ id: 'a', clientId: 'c1', montant: 10_000_000, status: 'TOTALEMENT_RETENU' }),
      mkOrder({ id: 'b', clientId: 'c2', montant: 5_000_000, status: 'NON_RETENU' }),
    ]);
    expect(cmp.volume()).toBe(15_000_000);
    expect(cmp.rate()).toBe(50);
    expect(cmp.clients()).toBe(2);
  });

  it('les tendances comparent à la période précédente de même durée', () => {
    // Sur « 12 » mois : l'ordre récent est dans la période, l'ancien dans la précédente.
    const cmp = build([
      mkOrder({ id: 'recent', montant: 20_000_000, dateSoumission: ago(10) }),
      mkOrder({ id: 'ancien', montant: 10_000_000, dateSoumission: ago(400) }),
    ]);
    cmp.period.set('12');
    expect(cmp.filtered().map((o) => o.id)).toEqual(['recent']);
    expect(cmp.volumeTrend()).toBe(100); // pas de base -> +100 %
  });

  it('sans donnée les KPI valent 0', () => {
    const cmp = build([]);
    expect(cmp.volume()).toBe(0);
    expect(cmp.rate()).toBe(0);
    expect(cmp.clients()).toBe(0);
    expect(cmp.countTrend()).toBe(0);
  });

  // ─── Graphiques ───────────────────────────────────────────────────────────

  it('les séries de graphiques suivent le nombre de mois de la période', () => {
    const cmp = build([mkOrder()]);
    expect(cmp.lineData()).toHaveLength(1);
    expect(cmp.barData()).toHaveLength(1);

    cmp.period.set('6');
    expect(cmp.lineData()).toHaveLength(6);
    expect(cmp.barData()).toHaveLength(6);
  });

  it('productData répartit le volume par « nature · émetteur »', () => {
    const cmp = build([
      mkOrder({ nature: 'BTA', emetteur: 'Cameroun', montant: 300 }),
      mkOrder({ id: 'o2', nature: 'OTA', emetteur: 'Gabon', montant: 700 }),
    ]);
    expect(cmp.productData()).toEqual([
      { label: 'OTA · Gabon', value: 700 },
      { label: 'BTA · Cameroun', value: 300 },
    ]);
  });

  it('clientData n’ajoute pas « Autres » quand tous les clients tiennent dans le top 6', () => {
    const cmp = build([mkOrder({ clientId: 'c1', clientNom: 'Alpha', montant: 100 })]);
    expect(cmp.clientData().map((d) => d.label)).toEqual(['Alpha']);
  });

  it('clientData regroupe le reste sous « Autres » au-delà de 6 clients', () => {
    const list = Array.from({ length: 8 }, (_, i) =>
      mkOrder({ id: `o${i}`, clientId: `c${i}`, clientNom: `Client ${i}`, montant: (i + 1) * 1000 }));
    const cmp = build(list);
    const labels = cmp.clientData().map((d) => d.label);
    expect(labels).toHaveLength(7);
    expect(labels.at(-1)).toBe('Autres');
    // « Autres » = volume total − somme du top 6 = 1000 + 2000
    expect(cmp.clientData().at(-1)!.value).toBe(3000);
  });

  it('topRows numérote les rangs et calcule la croissance', () => {
    const cmp = build([
      mkOrder({ id: 'a', clientId: 'c1', clientNom: 'Alpha', montant: 200, dateSoumission: ago(5) }),
      mkOrder({ id: 'b', clientId: 'c2', clientNom: 'Beta', montant: 100, dateSoumission: ago(5) }),
    ]);
    cmp.period.set('12');
    const rows = cmp.topRows();
    expect(rows.map((r) => [r.rang, r.nom])).toEqual([[1, 'Alpha'], [2, 'Beta']]);
    expect(rows[0].croissance).toBe(100); // aucune base sur la période précédente
  });

  // ─── Formatage ────────────────────────────────────────────────────────────

  it('trend() préfixe le signe', () => {
    const cmp = build();
    expect(cmp.trend(12)).toBe('+12%');
    expect(cmp.trend(0)).toBe('+0%');
    expect(cmp.trend(-7)).toBe('-7%');
  });

  it.each([
    [999, '999'],
    [1_500, '2 k'],
    [12_000_000, '12 M'],
    [2_500_000_000, '2,5 Md'],
  ])('fmtFcfa(%i) = %s', (v, attendu) => {
    expect(build().fmtFcfa(v)).toBe(attendu);
  });

  // ─── Export ───────────────────────────────────────────────────────────────

  it('genReport() refuse d’exporter une période vide', () => {
    const cmp = build([]);
    cmp.genReport();
    expect(creationsUrl).toBe(0);
    expect(toast.warn).toHaveBeenCalledWith('Aucune donnée', 'Aucun ordre sur la période sélectionnée.');
  });

  it('genReport() exporte un CSV avec BOM et notifie', async () => {
    const cmp = build([mkOrder({ reference: 'ORD-2026-000042', clientNom: 'Alpha' })]);
    cmp.genReport();

    expect(creationsUrl).toBe(1);
    expect(nomFichier).toMatch(/^rapport-svt-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(blobCapture!.type).toBe('text/csv;charset=utf-8');

    // `Blob.text()` retire le BOM au décodage UTF-8 : on le vérifie sur les octets.
    const octets = new Uint8Array(await blobCapture!.arrayBuffer());
    expect([...octets.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM pour Excel FR

    const contenu = await blobCapture!.text();
    expect(contenu).toContain('ORD-2026-000042');
    expect(contenu).toContain('Alpha');
    expect(contenu.split('\n')[0]).toContain('N° ordre');
    expect(toast.success).toHaveBeenCalledWith('Rapport généré', '1 ordre(s) exporté(s).');
  });

  it('genReport() échappe les valeurs contenant le séparateur « ; »', async () => {
    build([mkOrder({ clientNom: 'Alpha;Beta' })]).genReport();
    const contenu = await blobCapture!.text();
    expect(contenu).toContain('"Alpha;Beta"');
  });

  // ─── Rendu du gabarit ─────────────────────────────────────────────────────

  describe('rendu', () => {
    it('affiche l’état vide quand aucun ordre n’est présent', () => {
      const { el } = render([]);
      // Les donuts basculent sur leur `@else`…
      expect(el.textContent).toContain('Aucun ordre sur la période.');
      // …et le tableau affiche sa ligne unique d'état vide.
      const lignes = el.querySelectorAll('tbody tr');
      expect(lignes).toHaveLength(1);
      expect(lignes[0].textContent).toContain('Aucun ordre sur la période sélectionnée.');
      expect(el.querySelectorAll('afb-donut-chart')).toHaveLength(0);
    });

    it('affiche une ligne par client du classement', () => {
      const { el } = render([
        mkOrder({ id: 'a', clientId: 'c1', clientNom: 'Alpha', montant: 200 }),
        mkOrder({ id: 'b', clientId: 'c2', clientNom: 'Beta', montant: 100 }),
      ]);
      const lignes = el.querySelectorAll('tbody tr');
      expect(lignes).toHaveLength(2);
      expect(lignes[0].textContent).toContain('Alpha');
      expect(lignes[1].textContent).toContain('Beta');
      expect(el.textContent).not.toContain('Aucun ordre sur la période sélectionnée.');
      // Le 1er est mis en avant (pastille rouge).
      expect(lignes[0].querySelector('span')!.className).toContain('bg-afb-red');
    });

    it('affiche les donuts « produit » et « client » quand il y a des données', () => {
      const { el } = render([mkOrder()]);
      expect(el.querySelectorAll('afb-donut-chart').length).toBeGreaterThanOrEqual(2);
    });

    it('le bouton « Plage personnalisée » révèle les champs de dates', () => {
      const { fixture, cmp, el } = render([mkOrder()]);
      expect(el.querySelectorAll('input[type="date"]')).toHaveLength(0);

      bouton(el, 'Plage personnalisée').click();
      fixture.detectChanges();

      expect(cmp.period()).toBe('custom');
      expect(el.querySelectorAll('input[type="date"]')).toHaveLength(2);
    });

    it('un clic sur « Générer un rapport » sans donnée avertit sans télécharger', () => {
      const { el } = render([]);
      bouton(el, 'Générer un rapport').click();
      expect(creationsUrl).toBe(0);
      expect(toast.warn).toHaveBeenCalledOnce();
    });

    it('un clic sur « Générer un rapport » exporte les ordres de la période', () => {
      const { el } = render([mkOrder()]);
      bouton(el, 'Générer un rapport').click();
      expect(creationsUrl).toBe(1);
      expect(toast.success).toHaveBeenCalledOnce();
    });

    it('les KPI et tendances sont rendus dans la page', () => {
      const { el } = render([
        mkOrder({ id: 'a', clientId: 'c1', montant: 12_000_000, status: 'TOTALEMENT_RETENU' }),
      ]);
      expect(el.textContent).toContain('12 M');   // fmtFcfa
      expect(el.textContent).toMatch(/[+-]\d+%/); // trend()
    });
  });
});
