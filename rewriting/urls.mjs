export const WEBSITE_BASE_URL = 'test16.ndrewxie.repl.co';
export const WEBSITE_URL = 'http://' + WEBSITE_BASE_URL;

function btoa(data) {
    return Buffer.from(data).toString('base64');
}
function atob(data) {
    return Buffer.from(data, 'base64').toString('utf8');
}

export function decode_url(url) {
    try {
        if (!url) { return url; }
        if (url == '#') { return url; } 
        let url_obj = new URL(url, 'https://example.com');
        let split_url = url_obj.pathname.split('/');
        if (url.endsWith('/')) { split_url.pop(); }
        let actual_url = split_url.pop();
        return atob(decodeURIComponent(actual_url)).toString('utf8');
    }
    catch (e) { return url; }
}
export function encode_url(url) {
    let encode_payload = function(input) { return encodeURIComponent(btoa(input)); };
    const proxy_protcols = ['https:', 'http:'];
    try {
        let protocol = (new URL(url, 'https://www.example.com')).protocol;
        if (!proxy_protcols.includes(protocol.toLowerCase())) {
            return url;
        }
    } catch(e) { return url; }
    let is_absolute = new RegExp('^(?:[a-zA-Z]+:){1}\/\/');
    if (is_absolute.test(url)) {
        return '/reqs/' + encode_payload(url) + '/';
    }
    return encode_payload(url) + '/';
}