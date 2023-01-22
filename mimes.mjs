const mimes = {
    'html': 'text/html',
    'htm': 'text/html',
    'js': 'text/javascript',
    'mjs': 'text/javascript',
    'css': 'text/css',
    'wasm': 'application/wasm',
    'png': 'image/png',
    'jpeg': 'image/jpeg',
    'jpg': 'image/jpeg',
    'mp4': 'video/mp4',
    'json': 'application/json',
    'txt': 'text/plain',
    'rs': 'text/plain',
};
export function guess_mime(url) {
    let split = url.split('.');
    let ext = split[split.length-1].toLowerCase();
    if (mimes.hasOwnProperty(ext)) {
        return mimes[ext];
    }
    return 'application/octet-stream';
}