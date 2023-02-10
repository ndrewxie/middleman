import { decode_payload, encode_payload } from './base64.mjs';

export const WEBSITE_BASE_URL = 'passthrough.ndrewxie.repl.co';
export const WEBSITE_URL = 'https://' + WEBSITE_BASE_URL;

export const IS_ABSOLUTE = /^(?:[a-z+]+:)?\/\//;
const PROXY_PROTOCOLS = ['https:', 'http:'];

export function encode_url(url) {
    let actual_url = url;
    
    let fragment = '';
    try {
        let url_obj = new URL(actual_url, 'https://www.example.com');
        let protocol = url_obj.protocol;
        if (!PROXY_PROTOCOLS.includes(protocol.toLowerCase())) {
            return actual_url;
        }
        if (typeof url_obj.hash != 'undefined') {
            fragment = url_obj.hash;
        }
    } catch(e) { return actual_url; }

    // Remove hashes to prevent weird redirects
    actual_url = actual_url.replace(/(?:#[^#\/\?\.]*)*#[^#\/\?\.]*$/, '');

    let encoded = '';
    if (actual_url.length > 0) {
        if (IS_ABSOLUTE.test(actual_url)) {
            // This *needs* to be an absolute URL, as encode_url needs to preserve the 
            // invariant that an absolute URL will encode into an absolute URL
            encoded = WEBSITE_URL + '/q/';
        }
        encoded += encode_payload(actual_url) + '/';
    }
    encoded += fragment;
    return encoded;
}

export function decode_url(url) {
    let actual_url = url;
    if (!actual_url) { return url; }

    try {
        // Remove hashes
        actual_url = actual_url.replace(/(?:#[^#\/\?\.]*)*#[^#\/\?\.]*$/, '');
        if (actual_url.length == 0) { return url; } 
        let url_obj_in = new URL(actual_url, 'https://example.com');
        if (!PROXY_PROTOCOLS.includes(url_obj_in.protocol.toLowerCase())) {
            return url;
        }
        
        let path = url_obj_in.pathname.split('/');
        if (path[0] == '') { path.splice(0, 1); }
        if (path.at(-1) == '') { path.pop(); }
        if (path[0] != 'q') {
            // In theory we shouldn't be getting any fully relative URLs with a path length of more than 1
            return decode_payload(path[0]);
        }
        path.splice(0, 1);
        
        let url_out = new URL('https://example.com');
        for (let j = 0; j < path.length; j++) {
            let decoded = decode_payload(path[j]);
            url_out = new URL(decoded, url_out.href);
        }
        url_out.hash = url_obj_in.hash;

        return url_out.href;
    } catch (e) { return url; }
}