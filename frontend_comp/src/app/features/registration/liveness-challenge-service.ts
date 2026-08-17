import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const API_BASE = '/api/v1/liveness';

export type LivenessContexte = 'INSCRIPTION' | 'ORDRE' | 'CO_SIGNATURE';

export interface ActionAffichable {
  code: string;
  consigne: string;
}

export interface ChallengeCree {
  challengeId: string;
  actions: ActionAffichable[];
  expiresAt: string;
}

/** Une mesure horodatée transmise au serveur — jamais un verdict (cf. LivenessChallengeService cote backend). */
export interface LivenessFrame {
  tMs: number;
  yaw: number | null; pitch: number | null; roll: number | null;
  eyeCloseLeft: number | null; eyeCloseRight: number | null;
  mouthOpen: number | null;
  smileRatio: number | null;
  browRatio: number | null;
  faceBoxArea: number | null; faceBoxCx: number | null; faceBoxCy: number | null;
}

export interface ActionAffichee {
  actionCode: string;
  afficheeAtMs: number;
}

export interface VerifyResponse {
  statut: 'REUSSI' | 'ECHOUE';
}

/**
 * Défi de vivacité à actions imprévisibles — remplace le contrôle "clignement
 * unique". Le client ne calcule AUCUN verdict : il transmet des mesures brutes
 * horodatées, le serveur seul décide (cf. cahier des charges).
 */
@Injectable({ providedIn: 'root' })
export class LivenessChallengeService {
  private readonly http = inject(HttpClient);

  /** Tire un nouveau défi (2 ou 3 actions, tirées côté serveur). */
  creerDefi(contexteType: LivenessContexte, contexteRef?: string): Observable<ChallengeCree> {
    return this.http.post<ChallengeCree>(`${API_BASE}/challenge`, { contexteType, contexteRef });
  }

  /** Soumet les mesures collectées + l'image de comparaison. Réponse : REUSSI/ECHOUE, jamais le motif. */
  verifier(challengeId: string, imageBase64: string, actionsAffichees: ActionAffichee[],
           frames: LivenessFrame[]): Observable<VerifyResponse> {
    return this.http.post<VerifyResponse>(`${API_BASE}/challenge/${challengeId}/verify`,
      { imageBase64, actionsAffichees, frames });
  }

  /** Chemin de repli accessibilité : demande une vérification par un agent plutôt qu'un nouvel essai. */
  demanderRevueHumaine(challengeId: string): Observable<{ statut: string }> {
    return this.http.post<{ statut: string }>(`${API_BASE}/challenge/${challengeId}/request-review`, {});
  }
}
