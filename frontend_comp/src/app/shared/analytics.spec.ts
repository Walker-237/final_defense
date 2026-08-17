import { describe, it, expect } from 'vitest';
import {
  parseDate,
  pctChange,
  ordersInRange,
  volumeTotal,
  pendingCount,
  activeClients,
  successRate,
  natureSplit,
  ordersByWeekday,
  volumeByMonth,
  countByMonth,
  topClients,
  emetteurSplit,
} from './analytics';
import { Order, OrderStatus, TitleType } from '../core/models/models';

/** Ordre minimal ; seuls les champs agrégés comptent. */
function mkOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'o-1',
    reference: 'ORD-2025-000001',
    emissionId: 'em-1',
    emissionCode: 'CM1300001201',
    isin: 'CM1300001201',
    nature: 'BTA' as TitleType,
    emetteur: 'Cameroun',
    clientId: 'cli-1',
    clientNom: 'Client Un',
    compteEspeces: 'CPT-001',
    compteTitres: 'TCPT-001',
    volume: 10,
    montant: 10_000_000,
    tauxSoumis: 6,
    status: 'SOUMIS' as OrderStatus,
    dateSoumission: '2025-06-15 10:00',
    canal: 'EN_LIGNE',
    ...over,
  } as Order;
}

describe('parseDate', () => {
  it('renvoie null pour une valeur absente', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('analyse « AAAA-MM-JJ HH:mm » en heure locale', () => {
    expect(parseDate('2025-06-15 10:00')).toBe(new Date(2025, 5, 15, 10, 0).getTime());
  });

  it('analyse une date simple', () => {
    expect(parseDate('2025-06-15')).toBe(Date.parse('2025-06-15'));
  });

  it('renvoie null pour une chaîne non analysable', () => {
    expect(parseDate('pas-une-date')).toBeNull();
  });
});

describe('pctChange', () => {
  it('calcule une hausse', () => {
    expect(pctChange(150, 100)).toBe(50);
  });

  it('calcule une baisse', () => {
    expect(pctChange(50, 100)).toBe(-50);
  });

  it('arrondit à l’entier', () => {
    expect(pctChange(101, 300)).toBe(-66);
  });

  it('renvoie 100 quand la base est nulle mais la valeur non nulle', () => {
    expect(pctChange(42, 0)).toBe(100);
  });

  it('renvoie 0 quand les deux valeurs sont nulles', () => {
    expect(pctChange(0, 0)).toBe(0);
  });
});

describe('ordersInRange', () => {
  const from = new Date(2025, 5, 1).getTime();
  const to = new Date(2025, 5, 30).getTime();

  it('conserve les ordres dans l’intervalle, bornes incluses', () => {
    const orders = [
      mkOrder({ id: 'a', dateSoumission: '2025-06-01 00:00' }),
      mkOrder({ id: 'b', dateSoumission: '2025-06-15 10:00' }),
      mkOrder({ id: 'c', dateSoumission: '2025-06-30 00:00' }),
    ];
    expect(ordersInRange(orders, from, to).map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('exclut les ordres hors intervalle', () => {
    const orders = [
      mkOrder({ id: 'avant', dateSoumission: '2025-05-31 23:00' }),
      mkOrder({ id: 'apres', dateSoumission: '2025-07-01 00:00' }),
    ];
    expect(ordersInRange(orders, from, to)).toEqual([]);
  });

  it('exclut les ordres à date illisible', () => {
    expect(ordersInRange([mkOrder({ dateSoumission: 'n/a' })], from, to)).toEqual([]);
  });
});

describe('volumeTotal', () => {
  it('somme les montants', () => {
    expect(volumeTotal([mkOrder({ montant: 1000 }), mkOrder({ montant: 2500 })])).toBe(3500);
  });

  it('traite un montant absent comme 0', () => {
    expect(volumeTotal([mkOrder({ montant: undefined as any }), mkOrder({ montant: 100 })])).toBe(100);
  });

  it('renvoie 0 pour une liste vide', () => {
    expect(volumeTotal([])).toBe(0);
  });
});

describe('pendingCount', () => {
  it.each<OrderStatus>(['SOUMIS', 'EN_VERIFICATION', 'EN_ATTENTE_ADJUDICATION', 'EN_ATTENTE_SIGNATURES'])(
    'compte le statut en attente %s',
    (status) => {
      expect(pendingCount([mkOrder({ status })])).toBe(1);
    },
  );

  it.each<OrderStatus>(['TOTALEMENT_RETENU', 'PARTIELLEMENT_RETENU', 'NON_RETENU'])(
    'ne compte pas le statut finalisé %s',
    (status) => {
      expect(pendingCount([mkOrder({ status })])).toBe(0);
    },
  );
});

describe('activeClients', () => {
  it('compte les clients distincts', () => {
    const orders = [
      mkOrder({ clientId: 'a' }),
      mkOrder({ clientId: 'a' }),
      mkOrder({ clientId: 'b' }),
    ];
    expect(activeClients(orders)).toBe(2);
  });

  it('renvoie 0 sans ordre', () => {
    expect(activeClients([])).toBe(0);
  });
});

describe('successRate', () => {
  it('renvoie 0 quand aucun ordre n’a atteint l’adjudication', () => {
    expect(successRate([mkOrder({ status: 'SOUMIS' })])).toBe(0);
  });

  it('renvoie 100 quand tous les ordres adjugés sont retenus', () => {
    expect(successRate([
      mkOrder({ status: 'TOTALEMENT_RETENU' }),
      mkOrder({ status: 'PARTIELLEMENT_RETENU' }),
    ])).toBe(100);
  });

  it('ignore les ordres non adjugés dans le dénominateur', () => {
    expect(successRate([
      mkOrder({ status: 'TOTALEMENT_RETENU' }),
      mkOrder({ status: 'NON_RETENU' }),
      mkOrder({ status: 'SOUMIS' }), // hors adjudication
    ])).toBe(50);
  });

  it('arrondit à une décimale', () => {
    // 2 retenus / 3 adjugés = 66,666… → 66,7
    expect(successRate([
      mkOrder({ status: 'TOTALEMENT_RETENU' }),
      mkOrder({ status: 'PARTIELLEMENT_RETENU' }),
      mkOrder({ status: 'NON_RETENU' }),
    ])).toBe(66.7);
  });
});

describe('natureSplit', () => {
  it('agrège le volume par nature', () => {
    const out = natureSplit([
      mkOrder({ nature: 'BTA', montant: 1000 }),
      mkOrder({ nature: 'BTA', montant: 500 }),
      mkOrder({ nature: 'OTA', montant: 2000 }),
    ]);
    expect(out).toEqual([
      { label: 'BTA', value: 1500, color: '#c8102e' },
      { label: 'OTA', value: 2000, color: '#111827' },
    ]);
  });

  it('omet les natures à volume nul', () => {
    const out = natureSplit([mkOrder({ nature: 'OTA', montant: 300 })]);
    expect(out.map((d) => d.label)).toEqual(['OTA']);
  });

  it('renvoie une liste vide sans ordre', () => {
    expect(natureSplit([])).toEqual([]);
  });
});

describe('ordersByWeekday', () => {
  // Dimanche 15 juin 2025 → la semaine court du lundi 9 au dimanche 15.
  const now = new Date(2025, 5, 15, 12, 0);

  it('produit les 7 jours dans l’ordre Lun→Dim', () => {
    expect(ordersByWeekday([], now).map((d) => d.label))
      .toEqual(['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']);
  });

  it('compte les ordres du lundi et du dimanche de la semaine courante', () => {
    const out = ordersByWeekday([
      mkOrder({ dateSoumission: '2025-06-09 08:00' }), // lundi
      mkOrder({ dateSoumission: '2025-06-09 18:00' }), // lundi
      mkOrder({ dateSoumission: '2025-06-15 09:00' }), // dimanche
    ], now);
    expect(out[0].value).toBe(2);
    expect(out[6].value).toBe(1);
  });

  it('ignore les ordres hors de la semaine courante', () => {
    const out = ordersByWeekday([
      mkOrder({ dateSoumission: '2025-06-08 10:00' }), // dimanche précédent
      mkOrder({ dateSoumission: '2025-06-16 10:00' }), // lundi suivant
    ], now);
    expect(out.every((d) => d.value === 0)).toBe(true);
  });

  it('ignore les dates illisibles', () => {
    const out = ordersByWeekday([mkOrder({ dateSoumission: 'n/a' })], now);
    expect(out.every((d) => d.value === 0)).toBe(true);
  });
});

describe('volumeByMonth', () => {
  const now = new Date(2025, 5, 15); // juin 2025

  it('produit les n derniers mois, du plus ancien au plus récent', () => {
    expect(volumeByMonth([], 3, now).map((d) => d.label)).toEqual(['Avr', 'Mai', 'Juin']);
  });

  it('convertit le volume en millions de FCFA (arrondi)', () => {
    const out = volumeByMonth([
      mkOrder({ dateSoumission: '2025-06-02 10:00', montant: 12_400_000 }),
      mkOrder({ dateSoumission: '2025-06-20 10:00', montant: 1_000_000 }),
    ], 3, now);
    expect(out[2]).toEqual({ label: 'Juin', value: 13 });
  });

  it('laisse les mois sans ordre à 0', () => {
    const out = volumeByMonth([mkOrder({ dateSoumission: '2025-06-02 10:00', montant: 5_000_000 })], 3, now);
    expect(out[0].value).toBe(0);
    expect(out[1].value).toBe(0);
  });

  it('franchit correctement la limite d’année', () => {
    const janv = new Date(2025, 0, 15);
    expect(volumeByMonth([], 3, janv).map((d) => d.label)).toEqual(['Nov', 'Déc', 'Jan']);
  });
});

describe('countByMonth', () => {
  const now = new Date(2025, 5, 15);

  it('compte les ordres par mois', () => {
    const out = countByMonth([
      mkOrder({ dateSoumission: '2025-05-02 10:00' }),
      mkOrder({ dateSoumission: '2025-06-02 10:00' }),
      mkOrder({ dateSoumission: '2025-06-20 10:00' }),
    ], 3, now);
    expect(out.map((d) => d.value)).toEqual([0, 1, 2]);
  });

  it('ignore les dates illisibles', () => {
    const out = countByMonth([mkOrder({ dateSoumission: '' })], 2, now);
    expect(out.every((d) => d.value === 0)).toBe(true);
  });
});

describe('topClients', () => {
  it('classe les clients par volume décroissant', () => {
    const out = topClients([
      mkOrder({ clientId: 'a', clientNom: 'Alpha', montant: 100 }),
      mkOrder({ clientId: 'b', clientNom: 'Beta', montant: 900 }),
      mkOrder({ clientId: 'a', clientNom: 'Alpha', montant: 300 }),
    ], 5);
    expect(out).toEqual([
      { nom: 'Beta', volume: 900, orders: 1 },
      { nom: 'Alpha', volume: 400, orders: 2 },
    ]);
  });

  it('tronque au n demandé', () => {
    const orders = [1, 2, 3, 4].map((i) => mkOrder({ clientId: `c${i}`, montant: i * 100 }));
    expect(topClients(orders, 2)).toHaveLength(2);
  });

  it('se rabat sur le nom quand l’identifiant client manque', () => {
    const out = topClients([mkOrder({ clientId: '', clientNom: 'Sans Id', montant: 50 })], 5);
    expect(out[0]).toEqual({ nom: 'Sans Id', volume: 50, orders: 1 });
  });

  it('affiche un tiret quand ni identifiant ni nom', () => {
    const out = topClients([mkOrder({ clientId: 'x', clientNom: '', montant: 10 })], 5);
    expect(out[0].nom).toBe('—');
  });

  it('renvoie une liste vide sans ordre', () => {
    expect(topClients([], 5)).toEqual([]);
  });
});

describe('emetteurSplit', () => {
  it('agrège par « nature · émetteur » et trie par volume décroissant', () => {
    const out = emetteurSplit([
      mkOrder({ nature: 'BTA', emetteur: 'Cameroun', montant: 100 }),
      mkOrder({ nature: 'BTA', emetteur: 'Cameroun', montant: 200 }),
      mkOrder({ nature: 'OTA', emetteur: 'Gabon', montant: 500 }),
    ]);
    expect(out).toEqual([
      { label: 'OTA · Gabon', value: 500 },
      { label: 'BTA · Cameroun', value: 300 },
    ]);
  });

  it('omet les couples à volume nul', () => {
    const out = emetteurSplit([mkOrder({ montant: 0 })]);
    expect(out).toEqual([]);
  });

  it('limite le résultat à 6 entrées', () => {
    const orders = Array.from({ length: 9 }, (_, i) =>
      mkOrder({ nature: 'BTA', emetteur: `Pays${i}`, montant: (i + 1) * 100 }));
    expect(emetteurSplit(orders)).toHaveLength(6);
  });
});
