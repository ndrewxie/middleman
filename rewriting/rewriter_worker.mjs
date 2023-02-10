import { writeFileSync } from 'fs';

import { parentPort } from 'worker_threads';
import { HTMLRewriter } from './html_rewriter.mjs';
import { CSSRewriter } from './css_rewriter.mjs';
import { JSRewriter } from './js_rewriter.mjs';

let rewrite_type = undefined;
parentPort.on('message', (msg) => {
    try {
        return on_message(msg);
    }
    catch(e) {
        let error_string = 'REWRITE ERROR=================\n' +
            e.message + '\n' +
            e.stack + '\n' + 
            '/REWRITE ERROR=================';
        writeFileSync('debug.txt', error_string, {
            encoding: 'utf8',
            flag: 'a'
        });
        console.log(error_string);
        throw e;
    }
});

function on_message(message) {
    if (message instanceof Array) {
        if (message[0] == 'rewrite_request') { rewrite_type = message[1]; }
    }
    else if (typeof rewrite_type != 'undefined') {
        let stringified_code = Buffer.from(message.buffer, message.byteOffset, message.length 
* message.BYTES_PER_ELEMENT).toString();
        let rewriter = undefined;
        if (rewrite_type.includes('html')) {
            rewriter = new HTMLRewriter(stringified_code);
        }
        else if (rewrite_type.includes('css')) {
            rewriter = new CSSRewriter(stringified_code);
        }
        else if (rewrite_type.includes('javascript')) {
            rewriter = new JSRewriter(stringified_code);
        }
        
        if (!rewriter) {
            parentPort.postMessage(message); // just echo it back
            parentPort.postMessage(['end']);
            return;
        }
        let rewritten = Buffer.from(rewriter.rewrite(), 'utf-8');        
        let rewritten_u8 = new Uint8Array(
            rewritten.buffer,
            rewritten.byteOffset,
            rewritten.length / Uint8Array.BYTES_PER_ELEMENT
        );
        parentPort.postMessage(rewritten_u8, [rewritten_u8.buffer]);
        parentPort.postMessage(['end']);
    }
}