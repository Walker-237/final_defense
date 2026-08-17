import { Component, PLATFORM_ID, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { BarChart, ChartDatum, LineChart } from './charts';

/** Un graphique que l'assistant peut inserer dans sa reponse, au format
 *  {@code ```chart\n{...}\n``` } — cf. le prompt systeme du chatbot cote backend. */
interface ChartSpec {
  type: 'bar' | 'line';
  title?: string;
  data: ChartDatum[];
}

type Segment =
  | { kind: 'html'; html: string }
  | { kind: 'chart'; spec: ChartSpec };

const CHART_FENCE = /```chart\s*\n([\s\S]*?)```/g;

/**
 * Rendu d'un message de l'assistant conversationnel : markdown (listes,
 * tableaux, liens) assaini via DOMPurify, plus un mini-langage de graphique
 * (bloc ```chart```) rendu par les composants SVG existants (`afb-bar-chart`
 * / `afb-line-chart`) plutot qu'en laissant le modele emettre du HTML/SVG —
 * seules des donnees JSON traversent la frontiere IA -> DOM.
 *
 * Les liens internes ([texte](/client/...)) sont interceptes pour naviguer
 * via le Router Angular plutot que de recharger la page.
 */
@Component({
  selector: 'afb-chat-message',
  imports: [BarChart, LineChart],
  // Le contenu markdown est injecte via [innerHTML] : l'encapsulation Emulated
  // (par defaut) n'atteint jamais ce DOM-la, car Angular ne peut pas y poser ses
  // attributs _ngcontent-* — les styles ci-dessous resteraient sans effet sinon.
  encapsulation: ViewEncapsulation.None,
  template: `
    <div (click)="onClick($event)">
      @for (seg of segments(); track $index) {
        @if (seg.kind === 'html') {
          <div class="chat-md" [innerHTML]="seg.html"></div>
        } @else if (seg.spec.type === 'bar') {
          <div class="my-2">
            @if (seg.spec.title) { <p class="text-[11px] text-gray-500 mb-1">{{ seg.spec.title }}</p> }
            <afb-bar-chart [data]="seg.spec.data" />
          </div>
        } @else {
          <div class="my-2">
            @if (seg.spec.title) { <p class="text-[11px] text-gray-500 mb-1">{{ seg.spec.title }}</p> }
            <afb-line-chart [data]="seg.spec.data" />
          </div>
        }
      }
    </div>
  `,
  styles: `
    /* Tailwind reset neutralise les balises brutes issues du markdown (listes,
       tableaux, liens) : on leur redonne une apparence lisible ici, localement. */
    .chat-md :first-child { margin-top: 0; }
    .chat-md :last-child { margin-bottom: 0; }
    .chat-md p { margin: 0.4em 0; }
    .chat-md ul, .chat-md ol { margin: 0.4em 0; padding-left: 1.25em; }
    .chat-md ul { list-style: disc; }
    .chat-md ol { list-style: decimal; }
    .chat-md li { margin: 0.15em 0; }
    .chat-md a { color: #2563eb; text-decoration: underline; text-underline-offset: 2px; }
    .chat-md a:hover { color: #1d4ed8; }
    .chat-md strong { font-weight: 600; }
    .chat-md code { background: rgba(0,0,0,0.06); border-radius: 3px; padding: 0.1em 0.3em; font-size: 0.9em; }
    .chat-md table { border-collapse: collapse; margin: 0.5em 0; font-size: 0.9em; width: 100%; }
    .chat-md th, .chat-md td { border: 1px solid #e5e7eb; padding: 0.3em 0.5em; text-align: left; }
    .chat-md th { background: #f9fafb; font-weight: 600; }
  `,
})
export class ChatMessage {
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  content = input.required<string>();

  private static readonly INTERNAL_PREFIXES = ['/client/', '/backoffice/', '/auth/', '/emissions'];

  segments = computed<Segment[]>(() => this.parse(this.content()));

  private parse(text: string): Segment[] {
    const segments: Segment[] = [];
    let lastIndex = 0;
    CHART_FENCE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CHART_FENCE.exec(text))) {
      const before = text.slice(lastIndex, match.index);
      if (before.trim()) segments.push(this.htmlSegment(before));
      const spec = this.parseChartSpec(match[1]);
      if (spec) {
        segments.push({ kind: 'chart', spec });
      } else {
        // JSON invalide : on retombe sur un rendu texte plutot que de perdre le contenu.
        segments.push(this.htmlSegment(match[0]));
      }
      lastIndex = match.index + match[0].length;
    }
    const rest = text.slice(lastIndex);
    if (rest.trim() || !segments.length) segments.push(this.htmlSegment(rest));
    return segments;
  }

  private htmlSegment(markdown: string): Segment {
    if (!this.isBrowser) {
      // SSR : DOMPurify n'a pas de `window`. Le widget de chat n'a de contenu
      // qu'apres interaction utilisateur (jamais au premier rendu serveur),
      // mais on reste defensif : texte echappe, sans mise en forme.
      return { kind: 'html', html: escapeHtml(markdown) };
    }
    const raw = marked.parse(markdown, { async: false, breaks: true }) as string;
    return { kind: 'html', html: DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] }) };
  }

  private parseChartSpec(json: string): ChartSpec | null {
    try {
      const parsed = JSON.parse(json);
      if (parsed?.type !== 'bar' && parsed?.type !== 'line') return null;
      if (!Array.isArray(parsed.data)) return null;
      const data: ChartDatum[] = parsed.data
        .filter((d: any) => typeof d?.label === 'string' && typeof d?.value === 'number')
        .map((d: any) => ({ label: d.label, value: d.value }));
      if (!data.length) return null;
      return { type: parsed.type, title: typeof parsed.title === 'string' ? parsed.title : undefined, data };
    } catch {
      return null;
    }
  }

  /** Navigation SPA pour les liens internes generes par l'assistant (evite un rechargement complet). */
  onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement)?.closest('a');
    if (!target) return;
    const href = target.getAttribute('href');
    if (!href || !ChatMessage.INTERNAL_PREFIXES.some((p) => href.startsWith(p))) return;
    event.preventDefault();
    this.router.navigateByUrl(href);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
