import * as urls from './hooks/urls.mjs';

// used to have accept-encoding
const proxy_skip_headers = [
    'host',
    'referer',
    'origin',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-replit-user-id',
    'x-replit-user-name',
    'x-replit-user-roles',
    'x-replit-user-bio',
    'x-replit-user-profile-image',
    'x-replit-user-teams',
    'x-replit-user-url',
    'accept-encoding',
];
export function get_headers(encoded_request_url, input_headers) {
    let to_return = {};

    try {
        for (const key in input_headers) {
            let to_copy = true;
            if (proxy_skip_headers.includes(key.toLowerCase())) {
                continue;
            }
            to_return[key] = input_headers[key];
        }
    
        let input_referer = input_headers['Referer'] || input_headers['Referrer'];
        if (typeof input_referer != 'undefined') {
            let referer = new URL(urls.decode_url(input_referer));
            to_return['Referer'] = referer.href;
            to_return['Origin'] = referer.origin;
            to_return['Host'] = referer.host;
        }
    } catch(e) {}
    
    return to_return;
}

const rewrite_banned_headers = [
    'content-length',
    'content-range',
    'x-frame-options',
    'content-security-policy' // bad practice? sure, but nothing sensitive is happening here anyways
];
export function get_response_headers(headers, is_rewrite) {
    let to_return = {};
    let content_type = 
            headers['content-type'] || 
            headers['Content-Type'];
    if (content_type) { content_type = content_type.toLowerCase(); }
    
    let is_rewritten = is_rewrite(content_type);
    for (const header in headers) {
        if (is_rewritten && rewrite_banned_headers.includes(header.toLowerCase())) {
            continue;
        }
        to_return[header] = headers[header];
    }
    
    return {
        content_type: content_type,
        is_rewritten: is_rewritten,
        headers: to_return
    }
}