import './ui/style.css';
import { App } from './ui/app';

// Exposed for debugging and automated UI tests.
(window as any).petbrace = new App(document.getElementById('app')!);
