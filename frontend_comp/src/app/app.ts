import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastContainer } from './core/services/toast';
import { PdfProgressOverlay } from './core/services/pdf-progress';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastContainer, PdfProgressOverlay],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}
