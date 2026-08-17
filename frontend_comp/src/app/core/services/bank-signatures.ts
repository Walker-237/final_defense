import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, shareReplay, tap } from 'rxjs/operators';
import { SIGNATURES_DIRIGEANTS } from './api-endpoints';
// `import type` : SignataireBanque n'est qu'un type. Un import de valeur
// entraînerait tout download.ts — donc jspdf et html2canvas — dans le chunk de
// ce service (injecté à la racine), alors qu'ils ne servent qu'à la génération.
import type { SignataireBanque } from '../../shared/download';

/**
 * Signatures des dirigeants habilités, apposées sur les documents générés
 * (avis d'opéré, attestations).
 *
 * <p>Le résultat est mis en cache : un même écran génère souvent plusieurs
 * documents. Une panne de chargement ne bloque jamais la génération — le
 * document est simplement produit sans la signature de la banque.</p>
 */
@Injectable({ providedIn: 'root' })
export class BankSignaturesService {
  private readonly http = inject(HttpClient);
  private cache$: Observable<SignataireBanque[]> | null = null;

  /** Signatures actives, dans l'ordre défini par l'administration. */
  get(): Observable<SignataireBanque[]> {
    this.cache$ ??= this.http.get<SignataireBanque[]>(SIGNATURES_DIRIGEANTS.ACTIVES).pipe(
      // Un document sans signature vaut mieux qu'un document non généré.
      catchError(() => of([] as SignataireBanque[])),
      shareReplay(1),
    );
    return this.cache$;
  }

  /** Force le rechargement (après une modification dans l'administration). */
  invalider(): void {
    this.cache$ = null;
  }
}
