import { Directive, ElementRef, HostListener, OnInit, effect, inject, input } from '@angular/core';
import { NgControl } from '@angular/forms';
import { formaterCompte, formaterTelephone } from './masques';

export type TypeMasque = 'compte' | 'telephone';

/**
 * Masque de saisie appliqué à un champ.
 *
 * <ul>
 *   <li><b>compte</b> : préfixe <code>10005</code> imposé, groupes séparés par des
 *       espaces, saisie <b>verrouillée</b> à 22 chiffres ;</li>
 *   <li><b>telephone</b> : indicatif <code>+237</code> imposé, puis 9 chiffres,
 *       saisie <b>verrouillée</b> ensuite.</li>
 * </ul>
 *
 * <p>Le verrouillage est obtenu par construction : au-delà de la longueur prévue,
 * le formatage ignore les chiffres supplémentaires. Rien ne s'inscrit de plus,
 * y compris par collage.</p>
 *
 * <p>La valeur du formulaire est synchronisée avec l'affichage (ngModel), donc
 * l'écran travaille toujours sur la valeur formatée.</p>
 */
@Directive({
  selector: '[afbMasque]',
  standalone: true,
})
export class MasqueDirective implements OnInit {
  readonly afbMasque = input.required<TypeMasque>();

  private readonly el = inject(ElementRef<HTMLInputElement>);
  private readonly control = inject(NgControl, { optional: true, self: true });

  ngOnInit(): void {
    // Pré-remplit le champ avec le préfixe imposé (« 10005 » / « +237 »), pour
    // que l'utilisateur voie d'emblée la forme attendue.
    this.appliquer(this.input.value);
  }

  private get input(): HTMLInputElement {
    return this.el.nativeElement;
  }

  @HostListener('input')
  onInput(): void {
    this.appliquer(this.input.value);
  }

  /** Le collage passe par le même formatage : il ne contourne pas le masque. */
  @HostListener('paste', ['$event'])
  onPaste(ev: ClipboardEvent): void {
    ev.preventDefault();
    const colle = ev.clipboardData?.getData('text') ?? '';
    this.appliquer(this.input.value + colle);
  }

  /** Empêche d'effacer le préfixe imposé avec Retour arrière. */
  @HostListener('keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'Backspace') return;
    const prefixe = this.afbMasque() === 'compte' ? '10005 ' : '+237 ';
    const pos = this.input.selectionStart ?? 0;
    if (pos <= prefixe.length && this.input.selectionEnd === pos) {
      ev.preventDefault();
    }
  }

  private appliquer(brut: string): void {
    const formate = this.afbMasque() === 'compte'
      ? formaterCompte(brut)
      : formaterTelephone(brut);

    this.input.value = formate;
    // Curseur toujours en fin de saisie : le masque réécrit la valeur entière.
    this.input.setSelectionRange(formate.length, formate.length);

    // Synchronise le formulaire (ngModel / formControl) avec l'affichage.
    this.control?.control?.setValue(formate, { emitEvent: false });
  }
}
