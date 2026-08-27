import { App } from './App.js';
import './render/analysis/analysis.css';

declare global {
  interface Window {
    __APP__: App;
    __APP_READY__: Promise<void>;
  }
}

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const app = new App(canvas);
window.__APP__ = app;
window.__APP_READY__ = app.whenReady();
void app.start();
