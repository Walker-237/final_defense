import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { REGISTRATION } from '../../core/services/api-endpoints';
import { FaceCaptureResult } from './face-scan';

/** Réponse de `POST /registration/register`. */
export interface RegisterResponse {
  dossierId: string;
  titulaireId: string;
  auth: { accessToken: string; tokenType: string; expiresIn: number };
}

/** Corps d'inscription (étape 1 du parcours). */
export interface RegisterBody {
  email: string;
  password: string;
  nom: string;
  prenom?: string;
  telephone?: string;
  typePersonne?: 'PP' | 'PM';
  /** Un compte JOINT soumet chaque ordre a la cosignature des autres titulaires. */
  typeCompte?: 'INDIVIDUEL' | 'JOINT';
  compteEspeces: string;
}

/** Convention courante renvoyée par le backend. */
export interface ConventionDto {
  version: string;
  titre: string;
  contenuHtml: string;
  langue: string;
}

/**
 * Service du parcours d'auto-inscription. La session ouverte par `register`
 * (jeton d'accès) est conservée ici et rattachée explicitement aux appels
 * suivants du wizard (le prospect n'est pas encore « connecté » au sens de
 * `AuthService`).
 */
@Injectable({ providedIn: 'root' })
export class RegistrationService {
  private readonly http = inject(HttpClient);

  /** Jeton d'accès de la session d'inscription (mémoire volatile). */
  private token: string | null = null;

  register(body: RegisterBody): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(REGISTRATION.REGISTER, body);
  }

  /** Mémorise le jeton retourné par `register` pour authentifier la suite. */
  setToken(token: string): void {
    this.token = token;
  }

  /**
   * Oublie le jeton d'inscription — à appeler une fois le dossier déposé.
   *
   * Ce jeton n'a de raison d'être que pendant le dépôt (visage, pièces,
   * soumission). Le garder au-delà laisserait traîner de quoi agir sur le
   * dossier alors que le prospect est renvoyé vers l'écran de connexion.
   */
  clearToken(): void {
    this.token = null;
  }

  /** Dépose la capture faciale (image + repères + vivacité). */
  uploadFace(dossierId: string, face: FaceCaptureResult): Observable<{ faceId: string }> {
    return this.http.post<{ faceId: string }>(REGISTRATION.FACE(dossierId), face, {
      headers: this.authHeaders(),
    });
  }

  /** Dépose une pièce d'identité validée (CNI / carte de séjour / passeport). */
  uploadPiece(dossierId: string, piece: {
    imageBase64: string; cote: 'RECTO' | 'VERSO';
    /** Type reconnu par l'OCR, ou null : indicatif (le back-office tranche). */
    type: string | null;
    texte: string; nettete: number; largeur: number; hauteur: number;
  }): Observable<{ pieceId: string }> {
    return this.http.post<{ pieceId: string }>(
      REGISTRATION.PIECE_IDENTITE(dossierId), piece, { headers: this.authHeaders() });
  }

  /**
   * Soumet le dossier au back-office (`BROUILLON` → `EN_ATTENTE_VERIFICATION`).
   *
   * Sans cette étape le dossier resterait en brouillon : jamais examiné, donc
   * jamais validé — et le client n'obtiendrait jamais de compte-titres.
   */
  submit(dossierId: string): Observable<{ dossierId: string; statut: string }> {
    return this.http.post<{ dossierId: string; statut: string }>(
      REGISTRATION.SUBMIT(dossierId), {}, { headers: this.authHeaders() });
  }

  /** État courant du dossier (reprise). */
  getDossier(dossierId: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(REGISTRATION.DOSSIER(dossierId), {
      headers: this.authHeaders(),
    });
  }

  /** Convention courante (publique). */
  getConvention(langue: 'FR' | 'EN' = 'FR'): Observable<ConventionDto> {
    return this.http.get<ConventionDto>(`${REGISTRATION.CONVENTION}?langue=${langue}`);
  }

  private authHeaders(): HttpHeaders {
    return this.token
      ? new HttpHeaders({ Authorization: `Bearer ${this.token}` })
      : new HttpHeaders();
  }
}
