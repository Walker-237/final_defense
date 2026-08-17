import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PaginatePipe, Paginator } from './pagination';

describe('PaginatePipe', () => {
  const pipe = new PaginatePipe();
  const items = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it('renvoie [] pour une valeur nulle ou indéfinie', () => {
    expect(pipe.transform(null, 1)).toEqual([]);
    expect(pipe.transform(undefined, 1)).toEqual([]);
  });

  it('renvoie le tableau complet quand total ≤ pageSize', () => {
    const src = items(25);
    expect(pipe.transform(src, 1, 25)).toBe(src);
  });

  it('découpe la première page', () => {
    expect(pipe.transform(items(30), 1, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('découpe une page intermédiaire', () => {
    expect(pipe.transform(items(30), 2, 10)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('découpe une dernière page partielle', () => {
    expect(pipe.transform(items(25), 3, 10)).toEqual([21, 22, 23, 24, 25]);
  });

  it('borne une page inférieure à 1 sur la première page', () => {
    expect(pipe.transform(items(30), 0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pipe.transform(items(30), -5, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('borne une page supérieure au dernier index sur la dernière page', () => {
    expect(pipe.transform(items(30), 99, 10)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
  });

  it('utilise pageSize = 25 par défaut', () => {
    expect(pipe.transform(items(30), 2)).toEqual([26, 27, 28, 29, 30]);
  });
});

describe('Paginator', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Paginator>>;
  let cmp: Paginator;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Paginator] });
    fixture = TestBed.createComponent(Paginator);
    cmp = fixture.componentInstance;
  });

  function setup(total: number, pageSize = 10, page = 1) {
    fixture.componentRef.setInput('total', total);
    fixture.componentRef.setInput('pageSize', pageSize);
    cmp.page.set(page);
    fixture.detectChanges();
  }

  it('lastPage vaut au minimum 1 même sans élément', () => {
    setup(0);
    expect(cmp.lastPage()).toBe(1);
  });

  it('lastPage arrondit au supérieur', () => {
    setup(25, 10);
    expect(cmp.lastPage()).toBe(3);
  });

  it('from / to décrivent la fenêtre affichée', () => {
    setup(25, 10, 2);
    expect(cmp.from()).toBe(11);
    expect(cmp.to()).toBe(20);
  });

  it('to est borné par le total sur la dernière page', () => {
    setup(25, 10, 3);
    expect(cmp.from()).toBe(21);
    expect(cmp.to()).toBe(25);
  });

  it('go() borne la page entre 1 et lastPage', () => {
    setup(25, 10, 1);
    cmp.go(99);
    expect(cmp.page()).toBe(3);
    cmp.go(-1);
    expect(cmp.page()).toBe(1);
    cmp.go(2);
    expect(cmp.page()).toBe(2);
  });

  it('pages() liste toutes les pages sans ellipse quand lastPage ≤ 7', () => {
    setup(70, 10, 1);
    expect(cmp.pages()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('pages() ajoute une ellipse à droite près du début', () => {
    setup(200, 10, 1); // lastPage = 20
    expect(cmp.pages()).toEqual([1, 2, '…', 20]);
  });

  it('pages() ajoute une ellipse à gauche près de la fin', () => {
    setup(200, 10, 20);
    expect(cmp.pages()).toEqual([1, '…', 19, 20]);
  });

  it('pages() encadre la page courante de deux ellipses au milieu', () => {
    setup(200, 10, 10);
    expect(cmp.pages()).toEqual([1, '…', 9, 10, 11, '…', 20]);
  });

  it('la barre est masquée quand total ≤ pageSize', () => {
    setup(10, 10);
    expect((fixture.nativeElement as HTMLElement).querySelector('button')).toBeNull();
  });

  it('la barre est affichée quand total > pageSize', () => {
    setup(50, 10);
    expect((fixture.nativeElement as HTMLElement).querySelector('button')).not.toBeNull();
  });
});
