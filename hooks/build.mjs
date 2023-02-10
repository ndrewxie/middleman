import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';

export async function build() {
    await esbuild.build({
        entryPoints: ['./hooks/hook.mjs'],
        outdir: './bundled',
        bundle: true,
        minify: true, // false
        platform: "browser",
        format: "iife"
    });
}

let hook_txt = undefined;
export function get_hook() {
    if (typeof hook_txt == 'undefined') {
        hook_txt = readFileSync('./bundled/hook.js', { encoding: 'utf8' });
    }
    return `<script>
        (function() {
            if (window.proxy_hook_nonce == 1357) {
                return;
            }
            window.proxy_hook_nonce = 1357;
            ${hook_txt}
        })();
    </script>`;
}