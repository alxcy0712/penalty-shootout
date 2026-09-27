import {defineConfig} from 'vite';

// Polling keeps sandbox edits visible; strictPort avoids serving another version
// on an unexpected port when the existing preview needs to be restarted.
export default defineConfig({
  server:{port:5173,strictPort:true,watch:{usePolling:true,interval:250}},
  build:{rollupOptions:{input:{game:'index.html',motion:'motion-lab.html'}}},
});
