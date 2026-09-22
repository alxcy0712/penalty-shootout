import {defineConfig} from 'vite';

// Explicit polling keeps local previews current when native file events from
// the editor's sandbox are unavailable.
export default defineConfig({server:{watch:{usePolling:true,interval:250}}});
