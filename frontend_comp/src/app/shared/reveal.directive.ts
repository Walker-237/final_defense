import { Directive, ElementRef, inject, input, OnInit, OnDestroy } from '@angular/core';

/**
 * afbReveal — révèle l'élément (fondu + glissement) quand il entre dans le viewport.
 *
 * Technique : IntersectionObserver. Le navigateur nous prévient quand l'élément
 * devient visible, au lieu d'écouter l'événement `scroll` (qui se déclenche en
 * continu et pénalise les performances). On anime UNE fois, puis on arrête
 * d'observer — pas de re-jeu si l'utilisateur remonte/redescend.
 *
 * Usage :
 *   <section afbReveal>…</section>              (glisse depuis le bas)
 *   <div afbReveal="left">…</div>               (glisse depuis la gauche)
 *   <div afbReveal="right" [revealDelay]="150"> (glisse depuis la droite, +150ms)
 */
@Directive({
  selector: '[afbReveal]',
  standalone: true,
})
export class RevealDirective implements OnInit, OnDestroy {
  /** Direction du glissement : 'up' (défaut), 'left', 'right'. */
  readonly afbReveal = input<'up' | 'left' | 'right'>('up');
  /** Retard avant l'animation, en millisecondes (pour décaler des éléments). */
  readonly revealDelay = input<number>(0);

  private readonly el = inject(ElementRef<HTMLElement>);
  private observer?: IntersectionObserver;

  ngOnInit() {
    const node = this.el.nativeElement as HTMLElement;

    // Respecte « réduire les animations » : on affiche direct, sans animer.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.style.opacity = '1';
      node.style.transform = 'none';
      return;
    }

    // État de départ : invisible + légèrement décalé selon la direction.
    const offset = this.startOffset(this.afbReveal());
    node.style.opacity = '0';
    node.style.transform = offset;
    node.style.transition =
      'opacity 600ms cubic-bezier(0.16, 1, 0.3, 1), transform 600ms cubic-bezier(0.16, 1, 0.3, 1)';
    node.style.willChange = 'opacity, transform';

    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setTimeout(() => {
            node.style.opacity = '1';
            node.style.transform = 'none';
          }, this.revealDelay());
          // Une seule fois : on cesse d'observer cet élément.
          this.observer?.unobserve(node);
        }
      }
    }, {
      // Déclenche quand ~15% de l'élément est visible (pas besoin qu'il soit
      // entièrement dans l'écran — sinon les grands blocs s'animent trop tard).
      threshold: 0.15,
      // Marge négative en bas : l'animation démarre un peu AVANT que l'élément
      // touche le bord, donc elle est déjà finie quand l'utilisateur le regarde.
      rootMargin: '0px 0px -80px 0px',
    });

    this.observer.observe(node);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }

  private startOffset(dir: 'up' | 'left' | 'right'): string {
    switch (dir) {
      case 'left':  return 'translateX(-40px)';
      case 'right': return 'translateX(40px)';
      default:      return 'translateY(40px)';
    }
  }
}