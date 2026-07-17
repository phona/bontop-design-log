import { App } from './App.js';

declare global {
  interface Window {
    __APP__: App;
  }
}

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const app = new App(canvas);
window.__APP__ = app;
void app.start();
