import { App } from './App.js';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const app = new App(canvas);
void app.start();
