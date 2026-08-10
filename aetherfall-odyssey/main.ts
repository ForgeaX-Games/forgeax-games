/// <reference path="./src/vite-env.d.ts" />
// Canonical game entry for the Aetherfall exploration slice. Gameplay lives in
// the asset-resident plugin bundle;
// the host only needs the stable BootstrapEntry export from this file.
export { bootstrap } from './assets/plugins/bootstrap';
