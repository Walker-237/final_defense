import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BarChart, LineChart, DonutChart, CHARTS, ChartDatum } from './charts';

const AFB_RED = '#c8102e';
const TOP = 12;
const BOTTOM = 165;

/** Monte un composant graphique et applique ses entrées signal. */
function mount<T>(cmp: new (...a: any[]) => T, inputs: Record<string, unknown> = {}) {
  TestBed.configureTestingModule({ imports: [cmp as any] });
  const fixture = TestBed.createComponent(cmp);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

beforeEach(() => TestBed.resetTestingModule());

describe('CHARTS', () => {
  it('regroupe les trois graphiques', () => {
    expect(CHARTS).toEqual([BarChart, LineChart, DonutChart]);
  });
});

// ─── BarChart ────────────────────────────────────────────────────────────────

describe('BarChart', () => {
  it('ne produit aucune barre sans donnée', () => {
    const { cmp, el } = mount(BarChart, { data: [] });
    expect(cmp.bars()).toEqual([]);
    expect(el.querySelectorAll('rect')).toHaveLength(0);
  });

  it('produit une barre par donnée', () => {
    const data: ChartDatum[] = [{ label: 'Lun', value: 4 }, { label: 'Mar', value: 8 }];
    const { cmp, el } = mount(BarChart, { data });
    expect(cmp.bars()).toHaveLength(2);
    expect(el.querySelectorAll('rect')).toHaveLength(2);
  });

  it('la barre du maximum occupe toute la hauteur utile', () => {
    const { cmp } = mount(BarChart, { data: [{ label: 'a', value: 10 }, { label: 'b', value: 5 }] });
    const [a, b] = cmp.bars();
    expect(a.h).toBeCloseTo(BOTTOM - TOP, 6);
    expect(b.h).toBeCloseTo((BOTTOM - TOP) / 2, 6);
  });

  it('ancre les barres sur la ligne de base', () => {
    const { cmp } = mount(BarChart, { data: [{ label: 'a', value: 10 }] });
    const [a] = cmp.bars();
    expect(a.y + a.h).toBeCloseTo(BOTTOM, 6);
  });

  it('centre chaque barre sur son emplacement', () => {
    const { cmp } = mount(BarChart, { data: [{ label: 'a', value: 1 }, { label: 'b', value: 1 }] });
    for (const b of cmp.bars()) {
      expect(b.x).toBeCloseTo(b.cx - b.w / 2, 6);
    }
  });

  it('plafonne la largeur des barres à 48px', () => {
    const { cmp } = mount(BarChart, { data: [{ label: 'seul', value: 1 }] });
    expect(cmp.bars()[0].w).toBeLessThanOrEqual(48);
  });

  it('des valeurs toutes nulles donnent des barres de hauteur nulle (max borné à 1)', () => {
    const { cmp } = mount(BarChart, { data: [{ label: 'a', value: 0 }, { label: 'b', value: 0 }] });
    expect(cmp.bars().every((b) => b.h === 0)).toBe(true);
  });

  it('la grille compte 5 lignes, du max en haut à 0 en bas', () => {
    const { cmp } = mount(BarChart, { data: [{ label: 'a', value: 100 }] });
    const g = cmp.grid();
    expect(g).toHaveLength(5);
    expect(g[0].label).toBe('100');
    expect(g[4].label).toBe('0');
    expect(g[0].y).toBe(TOP);
    expect(g[4].y).toBe(BOTTOM);
  });

  it('abrège les valeurs de grille ≥ 1000 en « k »', () => {
    const { cmp } = mount(BarChart, { data: [{ label: 'a', value: 8000 }] });
    expect(cmp.grid()[0].label).toBe('8k');
  });

  it('affiche une décimale pour les valeurs de grille fractionnaires', () => {
    const { cmp } = mount(BarChart, { data: [{ label: 'a', value: 3 }] });
    // max=3, steps=4 → 2.25, 1.5, 0.75
    expect(cmp.grid().map((g) => g.label)).toEqual(['3', '2.3', '1.5', '0.8', '0']);
  });

  it('utilise la couleur par défaut, surchargeable', () => {
    const { cmp } = mount(BarChart, { data: [{ label: 'a', value: 1 }] });
    expect(cmp.color()).toBe(AFB_RED);

    TestBed.resetTestingModule();
    const other = mount(BarChart, { data: [{ label: 'a', value: 1 }], color: '#00ff00' });
    expect(other.cmp.color()).toBe('#00ff00');
  });

  it('expose le libellé et la valeur en infobulle SVG', () => {
    const { el } = mount(BarChart, { data: [{ label: 'Lun', value: 7 }] });
    expect(el.querySelector('title')?.textContent).toContain('Lun');
    expect(el.querySelector('title')?.textContent).toContain('7');
  });
});

// ─── LineChart ───────────────────────────────────────────────────────────────

describe('LineChart', () => {
  it('ne produit aucun point sans donnée', () => {
    const { cmp } = mount(LineChart, { data: [] });
    expect(cmp.points()).toEqual([]);
    expect(cmp.polyline()).toBe('');
  });

  it('place un point unique sur le bord gauche', () => {
    const { cmp } = mount(LineChart, { data: [{ label: 'a', value: 5 }] });
    expect(cmp.points()[0].x).toBe(60);
  });

  it('répartit les points de la gauche vers la droite', () => {
    const { cmp } = mount(LineChart, { data: [
      { label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: 3 },
    ] });
    const xs = cmp.points().map((p) => p.x);
    expect(xs[0]).toBe(60);
    expect(xs[2]).toBe(580);
    expect(xs[1]).toBeGreaterThan(xs[0]);
    expect(xs[2]).toBeGreaterThan(xs[1]);
  });

  it('le maximum touche le haut du cadre', () => {
    const { cmp } = mount(LineChart, { data: [{ label: 'a', value: 10 }, { label: 'b', value: 0 }] });
    expect(cmp.points()[0].y).toBeCloseTo(TOP, 6);
    expect(cmp.points()[1].y).toBeCloseTo(BOTTOM, 6);
  });

  it('polyline() sérialise les points « x,y » séparés par des espaces', () => {
    const { cmp } = mount(LineChart, { data: [{ label: 'a', value: 10 }, { label: 'b', value: 10 }] });
    const pts = cmp.points();
    expect(cmp.polyline()).toBe(`${pts[0].x},${pts[0].y} ${pts[1].x},${pts[1].y}`);
  });

  it('ne trace pas de polyligne pour un point unique', () => {
    const { el } = mount(LineChart, { data: [{ label: 'a', value: 1 }] });
    expect(el.querySelector('polyline')).toBeNull();
  });

  it('trace une polyligne dès deux points', () => {
    const { el } = mount(LineChart, { data: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] });
    expect(el.querySelector('polyline')).not.toBeNull();
  });

  it('rend un cercle par point', () => {
    const { el } = mount(LineChart, { data: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] });
    expect(el.querySelectorAll('circle')).toHaveLength(2);
  });

  it('la grille compte 5 lignes et abrège les milliers', () => {
    const { cmp } = mount(LineChart, { data: [{ label: 'a', value: 2000 }] });
    const g = cmp.grid();
    expect(g).toHaveLength(5);
    expect(g[0].label).toBe('2k');
    expect(g[4].label).toBe('0');
  });
});

// ─── DonutChart ──────────────────────────────────────────────────────────────

describe('DonutChart', () => {
  it('n’a aucune part sans donnée', () => {
    const { cmp, el } = mount(DonutChart, { data: [] });
    expect(cmp.slices()).toEqual([]);
    expect(cmp.total()).toBe(0);
    expect(el.textContent).toContain('Aucune donnée à afficher.');
  });

  it('ignore les valeurs nulles ou négatives', () => {
    const { cmp } = mount(DonutChart, { data: [
      { label: 'a', value: 0 }, { label: 'b', value: -5 }, { label: 'c', value: 10 },
    ] });
    expect(cmp.slices().map((s) => s.label)).toEqual(['c']);
  });

  it('n’a aucune part quand le total des valeurs positives est nul', () => {
    const { cmp } = mount(DonutChart, { data: [{ label: 'a', value: 0 }] });
    expect(cmp.slices()).toEqual([]);
  });

  it('total() somme toutes les valeurs, y compris nulles', () => {
    const { cmp } = mount(DonutChart, { data: [{ label: 'a', value: 3 }, { label: 'b', value: 7 }] });
    expect(cmp.total()).toBe(10);
  });

  it('pct() calcule le pourcentage arrondi', () => {
    const { cmp } = mount(DonutChart, { data: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] });
    expect(cmp.pct(1)).toBe(33);
    expect(cmp.pct(2)).toBe(67);
  });

  it('pct() renvoie 0 quand le total est nul', () => {
    const { cmp } = mount(DonutChart, { data: [] });
    expect(cmp.pct(5)).toBe(0);
  });

  it('produit une part par donnée positive', () => {
    const { cmp, el } = mount(DonutChart, { data: [
      { label: 'BTA', value: 60 }, { label: 'OTA', value: 40 },
    ] });
    expect(cmp.slices()).toHaveLength(2);
    expect(el.querySelectorAll('path')).toHaveLength(2);
  });

  it('honore la couleur fournie, sinon pioche dans la palette', () => {
    const { cmp } = mount(DonutChart, { data: [
      { label: 'a', value: 1, color: '#123456' }, { label: 'b', value: 1 },
    ] });
    expect(cmp.slices()[0].color).toBe('#123456');
    expect(cmp.slices()[1].color).toBe('#111827'); // 2e entrée de la palette
  });

  it('une part unique trace un cercle complet (pas un tracé dégénéré)', () => {
    const { cmp } = mount(DonutChart, { data: [{ label: 'seul', value: 5 }] });
    const path = cmp.slices()[0].path;
    expect(path).toContain('A 50 50 0 1 1');
    expect(path.startsWith('M 60 10')).toBe(true); // départ à midi (cy - r)
  });

  it('utilise le drapeau « grand arc » au-delà d’un demi-tour', () => {
    const { cmp } = mount(DonutChart, { data: [{ label: 'gros', value: 90 }, { label: 'petit', value: 10 }] });
    expect(cmp.slices()[0].path).toContain('A 50 50 0 1 1'); // > 180°
    expect(cmp.slices()[1].path).toContain('A 50 50 0 0 1'); // < 180°
  });

  it('affiche le total et les pourcentages dans la légende', () => {
    const { el } = mount(DonutChart, { data: [{ label: 'BTA', value: 75 }, { label: 'OTA', value: 25 }] });
    expect(el.textContent).toContain('100');
    expect(el.textContent).toContain('75%');
    expect(el.textContent).toContain('25%');
  });
});
