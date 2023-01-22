export function decode_payload(input) {
    let actual_input = decodeURIComponent(input);
    if (typeof atob !== 'undefined') {
        return atob(actual_input);
    }
    return Buffer.from(actual_input, 'base64').toString('utf8');
}

export function encode_payload(input) {
    let actual_encoded = '';
    if (typeof btoa !== 'undefined') {
        actual_encoded = btoa(input);
    }
    else {
        actual_encoded = Buffer.from(input).toString('base64');
    }
    return encodeURIComponent(actual_encoded);
}