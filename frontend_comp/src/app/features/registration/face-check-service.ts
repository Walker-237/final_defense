import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ORDER_FACE_CHECK } from '../../core/services/api-endpoints';
import { FaceCaptureResult } from './face-scan';

/** Verdict rendu par le SERVEUR (le client ne décide jamais de la correspondance). */
export interface FaceCheckResult {
  matchStatus: 'CORRESPOND' | 'DIFFERENT' | 'NON_COMPARABLE';
  matched: boolean;
  distance: number;
  seuil: number;
}

/**
 * Contrôle facial d'un ordre — « est-ce bien le titulaire qui passe cet ordre ? »
 *
 * <p>Déclenché <b>après</b> la soumission : l'ordre est déjà enregistré. Un échec
 * (ou même une panne réseau) ne remet jamais l'ordre en cause — le résultat sert
 * uniquement à la revue du back-office.</p>
 */
@Injectable({ providedIn: 'root' })
export class FaceCheckService {
  private readonly http = inject(HttpClient);

  /**
   * Envoie la photo du jour. N'échoue jamais du point de vue de l'appelant :
   * en cas d'erreur on renvoie `null` (l'ordre reste soumis).
   */
  checkOrder(orderId: string, face: FaceCaptureResult): Observable<FaceCheckResult | null> {
    return this.http
      .post<FaceCheckResult>(ORDER_FACE_CHECK.CHECK(orderId), {
        imageBase64: face.imageBase64,
        livenessScore: face.livenessScore,
        challengeType: face.challengeType,
        descriptor: face.descriptor,
      })
      .pipe(catchError(() => of(null)));
  }
}
