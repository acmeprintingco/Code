import '@fontsource-variable/inter';
import './ui/style.css';
import { applyTheme, initialTheme } from './ui/theme';
import { App } from './ui/app';

// Set the theme before the first paint to avoid a flash.
applyTheme(initialTheme());

// Exposed for debugging and automated UI tests.
(window as any).petbrace = new App(document.getElementById('app')!);
